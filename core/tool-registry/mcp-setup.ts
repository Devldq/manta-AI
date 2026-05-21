/**
 * MCP 连接设置 — 服务端一次性初始化逻辑。
 *
 * 遍历 KNOWN_MCP_SERVERS 配置表，按 mode 分别连接：
 * - stdio:  子进程 + env token
 * - remote: Remote HTTP + OAuth Bearer Token（需要先完成 OAuth 授权）
 *
 * 使用模块级单例：MCP 连接在首次需要时建立，后续请求复用同一个 ToolRegistry。
 */
import { ToolRegistry } from './registry';
import { MCPClient, MockMCPClient, RemoteMCPClient } from './mcp-client';
import { KNOWN_MCP_SERVERS } from './mcp-config';
import { getValidAccessToken } from './mcp-oauth';
import { conversationToolDefs } from '@/core/conversation/tools';
import { fsToolDefs } from '@/core/conversation/fs-tools';
import { ccToolDefs } from '@/core/conversation/cc-tools';

import type { MCPServerEntry, StdioServerConfig, RemoteServerConfig } from './types';

// ── 模块级单例 ───────────────────────────────────────────────────────────

let registry: ToolRegistry | null = null;
let mcpConnected = false;
let mcpInitPromise: Promise<void> | null = null;

/**
 * 获取预先配置好的 ToolRegistry（含内置工具 + MCP 工具）。
 * 首次调用时会自动初始化 MCP 连接（异步），后续调用立即返回。
 */
export async function getToolRegistry(): Promise<ToolRegistry> {
  if (!registry) {
    registry = new ToolRegistry();
    registry.register(...conversationToolDefs, ...fsToolDefs, ...ccToolDefs);
  }

  if (!mcpConnected) {
    if (!mcpInitPromise) {
      mcpInitPromise = connectAllMCPServers(registry);
    }
    await mcpInitPromise;
  }

  return registry;
}

/**
 * 获取所有工具（AI SDK 格式），供 agent-loop 直接使用。
 * 等价于 getToolRegistry().toAISDKFormat()。
 */
export async function getAgentTools(): Promise<Record<string, unknown>> {
  const reg = await getToolRegistry();
  return reg.toAISDKFormat();
}

/**
 * 关闭所有 MCP 连接，清理单例状态。
 * 主要用于测试或进程关闭前的清理。
 */
export async function shutdownMCP(): Promise<void> {
  if (registry) {
    await registry.closeAllMCP();
  }
  registry = null;
  mcpConnected = false;
  mcpInitPromise = null;
}

// ── 多 Server 连接逻辑 ────────────────────────────────────────────────────

/**
 * 遍历配置表，逐一连接所有 enabled 的 MCP Server。
 * 独立的 server 连接失败不影响其他 server。
 */
async function connectAllMCPServers(reg: ToolRegistry): Promise<void> {
  const enabledServers = KNOWN_MCP_SERVERS.filter((s) => s.enabled !== false);

  if (enabledServers.length === 0) {
    console.log('[ToolRegistry] 无启用的 MCP Server，跳过连接');
    mcpConnected = true;
    return;
  }

  console.log(`\n[ToolRegistry] 连接 ${enabledServers.length} 个 MCP Server...`);

  for (const entry of enabledServers) {
    try {
      if (entry.config.type === 'stdio') {
        await connectStdioServer(reg, entry);
      } else {
        await connectRemoteServer(reg, entry);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ToolRegistry]   ${entry.name} 连接失败: ${msg}`);
      // 继续连接下一个
    }
  }

  mcpConnected = true;
}

/**
 * 连接 Stdio 模式的 MCP Server。
 */
async function connectStdioServer(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<void> {
  const config = entry.config as StdioServerConfig;

  // 检查 GitHub token（向后兼容）
  if (entry.name === 'github') {
    const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!githubToken) {
      console.log(`[ToolRegistry]   未配置 GITHUB_PERSONAL_ACCESS_TOKEN，降级为 Mock`);
      const mockClient = new MockMCPClient();
      const tools = await reg.registerMCPServer(entry.name, mockClient);
      console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个 Mock 工具`);
      return;
    }
    config.env = { ...config.env, GITHUB_PERSONAL_ACCESS_TOKEN: githubToken };
  }

  // 检查是否可 spawn 进程
  let canSpawn = true;
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (!canSpawn) {
    console.log(`[ToolRegistry]   ${entry.name}: 无法 spawn 进程，降级为 Mock`);
    const mockClient = new MockMCPClient();
    const tools = await reg.registerMCPServer(entry.name, mockClient);
    console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个 Mock 工具`);
    return;
  }

  console.log(`[ToolRegistry]   连接 ${entry.name} (stdio)...`);
  const client = new MCPClient(config.command, config.args, config.env ?? {});
  const tools = await reg.registerMCPServer(entry.name, client);
  console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个工具`);
}

/**
 * 连接 Remote HTTP + OAuth 模式的 MCP Server。
 */
async function connectRemoteServer(
  reg: ToolRegistry,
  entry: MCPServerEntry,
): Promise<void> {
  const config = entry.config as RemoteServerConfig;

  // 检查是否有可用 token
  const token = await getValidAccessToken(entry.name, config.oauth);
  if (!token) {
    console.log(
      `[ToolRegistry]   ${entry.name}: 未授权（跳过），可通过 /api/mcp/oauth/start 发起授权`,
    );
    return;
  }

  console.log(`[ToolRegistry]   连接 ${entry.name} (remote)...`);
  const client = new RemoteMCPClient(config.url, () =>
    getValidAccessToken(entry.name, config.oauth),
  );
  const tools = await reg.registerMCPServer(entry.name, client);
  console.log(`[ToolRegistry]   ${entry.name}: ${tools.length} 个工具`);
}

/**
 * 单独连接指定的 Remote MCP Server（OAuth 授权完成后调用）。
 * 用于 OAuth 流程完成后将新授权的 server 动态注册到 Registry。
 */
export async function connectRemoteServerByName(serverName: string): Promise<string[]> {
  const entry = KNOWN_MCP_SERVERS.find((s) => s.name === serverName);
  if (!entry || entry.config.type !== 'remote') {
    throw new Error(`未找到 Remote MCP Server: ${serverName}`);
  }

  const config = entry.config as RemoteServerConfig;
  const token = await getValidAccessToken(serverName, config.oauth);
  if (!token) {
    throw new Error(`${serverName} 尚未完成 OAuth 授权`);
  }

  const reg = await getToolRegistry();
  const client = new RemoteMCPClient(config.url, () =>
    getValidAccessToken(serverName, config.oauth),
  );

  return reg.registerMCPServer(serverName, client);
}
