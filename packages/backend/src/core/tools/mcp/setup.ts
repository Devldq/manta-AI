/**
 * MCP 连接设置 — 服务端一次性初始化与运行时管理
 *
 * 参照 OpenCode 设计重构:
 * - 遍历配置表，按类型分别连接 (local / remote)
 * - remote 模式支持 headers 简单认证和 OAuth 两种方式
 * - 每个 server 独立的连接失败不影响其他 server
 * - 支持运行时动态连接/断开
 * - 使用模块级单例
 */
import { ToolRegistry } from '../registry/registry';
import { MCPClient, MockMCPClient, RemoteMCPClient } from './client';
import { getEffectiveServers, getMCPToolVisibility } from './config';
import { getValidAccessToken } from './oauth';
import { resolveEnvVarsInObject, normalizeServerConfig } from '../registry/types';
import { createAllTools } from '@tools/index';
import { createToolSearchTool } from '../registry/tool-search';
import {
  createOnDemandTools,
  type SkillCatalogEntry,
} from '../registry/on-demand-tools';
import { getSkill, listSkills } from '@storage/skill/store';

import type {
  MCPServerEntry,
  LocalServerConfig,
  RemoteServerConfig,
  MCPToolVisibility,
  MCPServerStatus,
} from '../registry/types';

// ── 模块级单例 ─────────────────────────────────────────────────────────────

let registry: ToolRegistry | null = null;
let mcpConnected = false;
let mcpInitPromise: Promise<void> | null = null;
let lastErrorMap = new Map<string, string>();

/** 启动时直接暴露给模型的高频核心工具。 */
const CORE_TOOL_NAMES = new Set([
  'read',
  'write',
  'edit',
  'multiEdit',
  'lsDir',
  'glob',
  'grep',
  'bash',
  'bashOutput',
  'bashKill',
]);

/**
 * 获取预先配置好的 ToolRegistry（含内置工具 + MCP 工具）。
 * 首次调用时在后台初始化 MCP 连接，但不会阻塞内置工具或 Agent 首字。
 * MCP 工具完成发现后会原子地加入 Registry，并通过固定 tool_search/tool_invoke
 * 桥进入 Messages；不会修改已经建立的 Conversation 固定层。
 */
export async function getToolRegistry(): Promise<ToolRegistry> {
  if (!registry) {
    registry = new ToolRegistry();
    // 使用工厂函数注册所有内置工具
    registry.register(...createAllTools());
    // tool_search 需要 registry 实例的引用，通过闭包注入
    registry.register(createToolSearchTool(registry));
  }

  if (!mcpConnected) {
    if (!mcpInitPromise) {
      mcpInitPromise = connectAllMCPServers(registry).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        lastErrorMap.set('__initialization__', message);
        mcpConnected = true;
        console.error(`[ToolRegistry] MCP 后台初始化失败: ${message}`);
      });
    }
  }

  return registry;
}

/**
 * Explicit MCP management actions need a stable view of the initial
 * connections. Agent prompt/tool reads deliberately do not call this helper.
 */
async function waitForMCPInitialization(): Promise<ToolRegistry> {
  const reg = await getToolRegistry();
  if (mcpInitPromise) await mcpInitPromise;
  return reg;
}

/**
 * 获取所有工具（AI SDK 格式），供 agent-loop 直接使用。
 */
export async function getAgentTools(): Promise<Record<string, unknown>> {
  const reg = await getToolRegistry();
  return reg.toAISDKFormat();
}

/**
 * 根据 agent 获取可见的工具列表（AI SDK 格式）
 *
 * 支持 per-agent 的 glob 模式 MCP 工具过滤
 *
 * @param agentName agent 名称 (null 表示默认)
 * @param visibility 工具可见性覆盖配置 (不提供则使用全局配置)
 */
export async function getAgentToolsForAgent(
  agentName: string | null,
  visibility?: MCPToolVisibility | null,
): Promise<Record<string, unknown>> {
  const reg = await getToolRegistry();
  const effectiveVisibility = visibility ?? getMCPToolVisibility();
  return reg.toAISDKFormatForAgent(agentName, effectiveVisibility);
}

export interface AgentPromptToolContext {
  toolCount: number
  deferredToolSummary: string
}

export interface AgentRunToolSnapshot extends AgentPromptToolContext {
  tools: Record<string, unknown>
  coreToolNames: string[]
  deferredToolNames: string[]
  skillIds: string[]
}

interface AgentRunToolSelection {
  initialTools: import('../registry/types').ToolDefinition[]
  deferredTools: import('../registry/types').ToolDefinition[]
  skills: SkillCatalogEntry[]
  deferredToolSummary: string
}

function getSkillCatalog(agentName: string | null): SkillCatalogEntry[] {
  try {
    return listSkills()
      .filter(skill =>
        skill.enabled &&
        (
          !skill.boundAgents?.length ||
          (agentName ? skill.boundAgents.includes(agentName) : false)
        ),
      )
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      }))
  } catch {
    // Agent 启动不能因 Skill Registry 暂时不可用而失败。
    return []
  }
}

function appendSkillCatalog(toolSummary: string, skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) return toolSummary
  const lines = [
    toolSummary,
    toolSummary ? '' : '## 可用能力（按需加载）',
    '### Skills',
    '',
    ...skills.map(skill => `- **${skill.id} / ${skill.name}**: ${skill.description}`),
  ]
  return lines.filter((line, index) => line || index > 0).join('\n')
}

function buildAgentRunToolSelection(
  reg: ToolRegistry,
  agentName: string | null,
  visibility?: MCPToolVisibility | null,
): AgentRunToolSelection {
  const effectiveVisibility = visibility ?? getMCPToolVisibility()
  const visibleTools = reg.getByAgent(agentName, effectiveVisibility)
  const coreTools = visibleTools.filter(tool => CORE_TOOL_NAMES.has(tool.name))
  const deferredTools = visibleTools.filter(tool =>
    tool.name !== 'tool_search' &&
    !CORE_TOOL_NAMES.has(tool.name),
  )
  const skills = getSkillCatalog(agentName)
  const onDemandTools = createOnDemandTools({
    registry: reg,
    deferredTools,
    resolveDeferredTools: () => reg
      .getByAgent(agentName, effectiveVisibility)
      .filter(tool => tool.name !== 'tool_search' && !CORE_TOOL_NAMES.has(tool.name)),
    skills,
    loadSkill: id => {
      const skill = getSkill(id)
      if (!skill?.enabled) return null
      return {
        id: skill.id,
        name: skill.metadata.name,
        description: skill.metadata.description,
        content: skill.content,
        parameters: skill.parameters,
        tools: skill.tools,
      }
    },
  })

  return {
    initialTools: [...coreTools, ...onDemandTools],
    deferredTools,
    skills,
    deferredToolSummary: appendSkillCatalog(
      reg.getDeferredToolSummary(deferredTools),
      skills,
    ),
  }
}

/**
 * 从同一个 Registry 状态生成 Conversation 的固定工具快照。
 *
 * Prompt 中的工具摘要和传给模型的可执行 Schema 必须来自同一次读取；
 * 后续 MCP 连接只能通过固定 tool_search/tool_invoke 桥进入 Messages。
 */
export async function getAgentRunToolSnapshot(
  agentName: string | null,
  visibility?: MCPToolVisibility | null,
): Promise<AgentRunToolSnapshot> {
  const reg = await getToolRegistry()
  const selection = buildAgentRunToolSelection(reg, agentName, visibility)
  return {
    toolCount: selection.initialTools.length,
    deferredToolSummary: selection.deferredToolSummary,
    tools: reg.toAISDKFormatForDefinitions(selection.initialTools),
    coreToolNames: selection.initialTools.map(tool => tool.name),
    deferredToolNames: selection.deferredTools.map(tool => tool.name),
    skillIds: selection.skills.map(skill => skill.id),
  }
}

export async function getAgentPromptToolContext(agentName: string | null): Promise<AgentPromptToolContext> {
  const reg = await getToolRegistry()
  const selection = buildAgentRunToolSelection(reg, agentName)
  return {
    toolCount: selection.initialTools.length,
    deferredToolSummary: selection.deferredToolSummary,
  }
}

/**
 * 关闭所有 MCP 连接，清理单例状态。
 */
export async function shutdownMCP(): Promise<void> {
  if (mcpInitPromise) await mcpInitPromise;
  if (registry) {
    await registry.closeAllMCP();
  }
  registry = null;
  mcpConnected = false;
  mcpInitPromise = null;
  lastErrorMap.clear();
}

// ── 多 Server 连接逻辑 ─────────────────────────────────────────────────────

/**
 * 遍历配置表，逐一连接所有 enabled 的 MCP Server。
 */
async function connectAllMCPServers(reg: ToolRegistry): Promise<void> {
  const enabledServers = getEffectiveServers()
    .filter((s) => s.enabled !== false)
    .map(normalizeServerConfig); // 兼容旧 stdio 格式

  if (enabledServers.length === 0) {
    console.log('[ToolRegistry] 无启用的 MCP Server，跳过连接');
    mcpConnected = true;
    return;
  }

  console.log(`\n[ToolRegistry] 连接 ${enabledServers.length} 个 MCP Server...`);

  for (const entry of enabledServers) {
    try {
      if (entry.config.type === 'local') {
        await connectLocalServer(reg, entry);
      } else {
        await connectRemoteServer(reg, entry);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ToolRegistry]   ${entry.name} 连接失败: ${msg}`);
      lastErrorMap.set(entry.name, msg);
      // 继续连接下一个
    }
  }

  mcpConnected = true;
}

/**
 * 解析 local 配置的环境变量，如果配置了 OAuth 则尝试注入 token。
 *
 * 流程：
 * 1. 先解析 {env:VAR} 引用为实际环境变量值
 * 2. 如果配置了 oauth，尝试获取有效 token
 * 3. 如果 token 存在，注入到 oauth.tokenEnvVar 指定的环境变量中
 *
 * @param serverName MCP Server 名称
 * @param config Local MCP Server 配置
 * @returns 解析后的配置（含 OAuth token）
 */
async function resolveLocalConfigWithOAuth(
  serverName: string,
  config: LocalServerConfig,
): Promise<Pick<LocalServerConfig, 'command' | 'environment' | 'timeout'>> {
  // 解析环境变量中的 {env:VAR} 引用
  const environment = config.environment
    ? resolveEnvVarsInObject(config.environment)
    : {};

  // 如果配置了 OAuth，尝试获取 token 并注入到环境变量
  if (config.oauth) {
    const resolvedOAuth = resolveEnvVarsInObject(config.oauth);
    const token = await getValidAccessToken(serverName, resolvedOAuth);

    if (token) {
      // 注入到指定的环境变量
      const envVar = config.oauth.tokenEnvVar;
      if (envVar) {
        environment[envVar] = token;
        console.log(
          `[ToolRegistry]   ${serverName}: OAuth token 已注入到 ${envVar}`,
        );
      }
    } else {
      // token 不存在：不做注入，依赖已有的 environment 配置
      // (例如用户可能手动设置了 env 变量，或后续通过 UI 发起 OAuth)
      console.log(
        `[ToolRegistry]   ${serverName}: 无有效 OAuth token，使用默认环境变量`,
      );
    }
  }

  return {
    command: config.command,
    environment,
    timeout: config.timeout,
  };
}

/**
 * 连接本地 (local) 模式的 MCP Server
 */
async function connectLocalServer(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<void> {
  const config = entry.config as LocalServerConfig;

  // 检查是否可 spawn 进程
  let canSpawn = true;
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (!canSpawn) {
    console.log(
      `[ToolRegistry]   ${entry.name}: 无法 spawn 进程，降级为 Mock`,
    );
    const mockClient = new MockMCPClient();
    const tools = await reg.registerMCPServer(entry.name, mockClient);
    console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个 Mock 工具`);
    return;
  }

  // 解析环境变量中的 {env:VAR} 引用 + OAuth token 注入
  const resolvedConfig = await resolveLocalConfigWithOAuth(entry.name, config);

  console.log(`[ToolRegistry]   连接 ${entry.name} (local)...`);
  const client = new MCPClient(resolvedConfig);
  const tools = await reg.registerMCPServer(entry.name, client);
  console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个工具`);

  // 清除之前的错误
  lastErrorMap.delete(entry.name);
}

/**
 * 连接远程 (remote) 模式的 MCP Server
 *
 * 支持两种认证:
 * 1. headers 简单认证 (API Key / Bearer Token)
 * 2. OAuth 2.0 + PKCE 认证
 */
async function connectRemoteServer(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<void> {
  const config = entry.config as RemoteServerConfig;

  // 解析 headers 中的 {env:VAR} 引用
  const headers = config.headers
    ? resolveEnvVarsInObject(config.headers)
    : undefined;

  // 检查是否有 OAuth 配置
  const hasOAuth = !!config.oauth;

  // 如果有 OAuth 配置，先检查 token
  if (hasOAuth && config.oauth) {
    // 解析 oauth clientId 中的 {env:VAR} 引用
    const resolvedOAuth = resolveEnvVarsInObject(config.oauth);
    const token = await getValidAccessToken(entry.name, resolvedOAuth);

    if (!token) {
      console.log(
        `[ToolRegistry]   ${entry.name}: 未授权（跳过），可通过 /api/mcp/oauth/start 发起授权`,
      );
      return;
    }

    console.log(`[ToolRegistry]   连接 ${entry.name} (remote + OAuth)...`);
    const client = new RemoteMCPClient(config.url, {
      headers,
      tokenProvider: () => getValidAccessToken(entry.name, resolvedOAuth),
      timeout: config.timeout,
    });
    const tools = await reg.registerMCPServer(entry.name, client);
    console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个工具`);
    lastErrorMap.delete(entry.name);
  } else {
    // 纯 headers 认证模式
    console.log(`[ToolRegistry]   连接 ${entry.name} (remote + headers)...`);
    const client = new RemoteMCPClient(config.url, {
      headers,
      timeout: config.timeout,
    });
    const tools = await reg.registerMCPServer(entry.name, client);
    console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个工具`);
    lastErrorMap.delete(entry.name);
  }
}

// ── 运行时连接管理 ─────────────────────────────────────────────────────────

/**
 * 单独连接指定的 MCP Server（支持 local 和 remote 两种模式）。
 *
 * @param serverName MCP Server 名称
 * @returns 注册的工具名列表
 */
export async function connectServerByName(
  serverName: string,
): Promise<string[]> {
  const rawEntry = getEffectiveServers().find((s) => s.name === serverName);
  if (!rawEntry) {
    throw new Error(`未找到 MCP Server: ${serverName}`);
  }

  const entry = normalizeServerConfig(rawEntry); // 兼容旧 stdio 格式
  const reg = await waitForMCPInitialization();

  // 如果已连接，先断开
  if (reg.isMCPServerConnected(serverName)) {
    await reg.unregisterMCPServer(serverName);
  }

  if (entry.config.type === 'local') {
    return connectLocalServerByName(reg, entry);
  } else {
    return connectRemoteServerByName(reg, entry);
  }
}

/**
 * 断开指定的 MCP Server 连接。
 *
 * @param serverName MCP Server 名称
 * @returns 被移除的工具数量
 */
export async function disconnectServerByName(
  serverName: string,
): Promise<number> {
  const reg = await waitForMCPInitialization();
  return reg.unregisterMCPServer(serverName);
}

/**
 * 单独连接本地 MCP Server
 */
async function connectLocalServerByName(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<string[]> {
  const config = entry.config as LocalServerConfig;

  let canSpawn = true;
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (!canSpawn) {
    console.log(
      `[ToolRegistry]   ${entry.name}: 无法 spawn 进程，降级为 Mock`,
    );
    const mockClient = new MockMCPClient();
    return reg.registerMCPServer(entry.name, mockClient);
  }

  // 解析环境变量中的 {env:VAR} 引用 + OAuth token 注入
  const resolvedConfig = await resolveLocalConfigWithOAuth(entry.name, config);

  console.log(`[ToolRegistry]   连接 ${entry.name} (local)...`);
  const client = new MCPClient(resolvedConfig);
  const tools = await reg.registerMCPServer(entry.name, client);
  lastErrorMap.delete(entry.name);
  return tools;
}

/**
 * 单独连接远程 MCP Server
 */
async function connectRemoteServerByName(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<string[]> {
  const config = entry.config as RemoteServerConfig;
  const headers = config.headers
    ? resolveEnvVarsInObject(config.headers)
    : undefined;

  const hasOAuth = !!config.oauth;

  if (hasOAuth && config.oauth) {
    const resolvedOAuth = resolveEnvVarsInObject(config.oauth);
    const token = await getValidAccessToken(entry.name, resolvedOAuth);
    if (!token) {
      throw new Error(`${entry.name} 尚未完成 OAuth 授权`);
    }

    console.log(`[ToolRegistry]   连接 ${entry.name} (remote + OAuth)...`);
    const client = new RemoteMCPClient(config.url, {
      headers,
      tokenProvider: () => getValidAccessToken(entry.name, resolvedOAuth),
      timeout: config.timeout,
    });
    const tools = await reg.registerMCPServer(entry.name, client);
    lastErrorMap.delete(entry.name);
    return tools;
  } else {
    console.log(`[ToolRegistry]   连接 ${entry.name} (remote + headers)...`);
    const client = new RemoteMCPClient(config.url, {
      headers,
      timeout: config.timeout,
    });
    const tools = await reg.registerMCPServer(entry.name, client);
    lastErrorMap.delete(entry.name);
    return tools;
  }
}

// ── 状态查询 ────────────────────────────────────────────────────────────────

/**
 * 获取所有 MCP Server 的状态（含连接状态、工具列表等）
 */
export async function getAllMCPServerStatus(): Promise<MCPServerStatus[]> {
  const reg = await getToolRegistry();
  const entries = getEffectiveServers().map(normalizeServerConfig);

  return entries.map((entry) => {
    const isConnected = reg.isMCPServerConnected(entry.name);
    const toolNames = isConnected ? reg.getMCPToolNames(entry.name) : [];
    const isRemote = entry.config.type === 'remote';
    const isLocal = entry.config.type === 'local';

    let oauthAuthorized: boolean | undefined;
    let oauthRequired: boolean | undefined;

    if (isRemote) {
      const remoteConfig = entry.config as RemoteServerConfig;
      oauthRequired = !!remoteConfig.oauth;
    } else if (isLocal) {
      const localConfig = entry.config as LocalServerConfig;
      oauthRequired = !!localConfig.oauth;
    }

    if (oauthRequired) {
      // TODO: 异步检查 OAuth 状态
      oauthAuthorized = undefined;
    }

    return {
      name: entry.name,
      enabled: entry.enabled !== false,
      type: entry.config.type,
      isConnected,
      toolCount: toolNames.length,
      toolNames,
      oauthAuthorized,
      oauthRequired,
      lastError: lastErrorMap.get(entry.name),
    };
  });
}

/**
 * @deprecated 使用 connectServerByName 替代
 */
export async function connectRemoteServerByNameCompat(
  serverName: string,
): Promise<string[]> {
  return connectServerByName(serverName);
}
