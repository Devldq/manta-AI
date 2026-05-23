/**
 * MCP (Model Context Protocol) 类型定义
 *
 * 参照 OpenCode 设计重构:
 * - local:  本地子进程模式 (原 stdio)
 * - remote: 远程 HTTP 模式 (支持 headers + OAuth 两种认证)
 *
 * 新增:
 * - {env:VAR_NAME} 环境变量引用语法
 * - timeout 配置 (每个 server 独立超时)
 * - headers 简单认证 (不再强制 OAuth)
 * - per-agent glob 模式工具控制
 */

// ── 核心工具定义 ────────────────────────────────────────────────────────────

/** 工具定义接口 — 统一工具描述格式 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 对象（未经 jsonSchema() 包装） */
  parameters: Record<string, unknown>;
  /** 是否并发安全（可并行执行）：true=共享锁，false=独占锁 */
  isConcurrencySafe?: boolean;
  /** 是否只读工具 */
  isReadOnly?: boolean;
  /** 执行结果最大字符数，超出则截断（默认 3000） */
  maxResultChars?: number;
  /** 工具执行函数 */
  execute: (input: any) => Promise<unknown>;
  /** 来源：MCP server 名称 (仅 MCP 工具) */
  mcpServer?: string;
  /** 原始工具名 (仅 MCP 工具, 不含前缀) */
  mcpToolName?: string;
  /**
   * 是否延迟加载。
   *
   * 参照 Claude Code 设计：
   * - 核心工具（文件操作、搜索、命令执行）始终加载，不设此标记
   * - 低频工具（WebSearch、MCP 工具等）标记为 true，仅在需要时加载
   *
   * 延迟加载阈值：当 shouldDefer 工具的 Schema 总量超过上下文窗口 10% 时触发。
   */
  shouldDefer?: boolean;
  /**
   * 搜索提示词 — 给 ToolSearch 用的匹配线索。
   *
   * 3-10 个词的英文短语，描述工具能做什么。
   * 模型不会看到这些 hint，仅在 ToolSearch 内部做关键词匹配。
   *
   * 示例：
   * - 浏览器导航: "browser navigate open url webpage"
   * - Supabase 查询: "supabase database sql query select"
   * - 文件搜索:   "find files pattern glob search match"
   */
  searchHint?: string;
}

/** MCP Server 暴露的单个工具描述 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 客户端接口 */
export interface MCPClientLike {
  connect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

// ── MCP Server 配置类型 (对齐 OpenCode) ─────────────────────────────────────

/**
 * 本地 MCP Server (type: "local")
 *
 * 通过本地命令启动 MCP Server 子进程，使用 STDIO 通信。
 *
 * 对应 OpenCode 的 type: "local"
 *
 * 支持两种认证方式:
 * 1. environment: 通过 {env:VAR_NAME} 引用环境变量 (如 GITHUB_PERSONAL_ACCESS_TOKEN)
 * 2. oauth:   OAuth 2.0 + PKCE 认证 — 获取 token 后注入到 environment (需设置 tokenEnvVar)
 */
export interface LocalServerConfig {
  type: 'local';
  /** 运行命令及参数 (数组形式, 如 ["npx", "-y", "@modelcontextprotocol/server-github"]) */
  command: string[];
  /** 环境变量, 支持 {env:VAR_NAME} 语法引用系统环境变量 */
  environment?: Record<string, string>;
  /** OAuth 配置 (可选。设置后优先走 OAuth 获取 token, 注入到 environment 中) */
  oauth?: OAuthServerConfig;
  /** 连接/工具调用超时 (毫秒), 默认 5000 */
  timeout?: number;
}

/**
 * 远程 MCP Server (type: "remote")
 *
 * 通过 HTTP 连接远程 MCP Server, 支持两种认证方式:
 * 1. headers: 简单 API Key / Bearer Token 认证
 * 2. oauth:  OAuth 2.0 + PKCE 认证 (优先级高于 headers)
 *
 * 对应 OpenCode 的 type: "remote"
 */
export interface RemoteServerConfig {
  type: 'remote';
  /** 远程 MCP Server 的 Streamable HTTP 端点 */
  url: string;
  /** HTTP 请求头 (如 API Key 认证), 支持 {env:VAR_NAME} 语法 */
  headers?: Record<string, string>;
  /** OAuth 配置 (如果设置了此字段则走 OAuth 认证, headers 仅作为额外请求头) */
  oauth?: OAuthServerConfig;
  /** 连接/工具调用超时 (毫秒), 默认 5000 */
  timeout?: number;
}

// ── OAuth 配置 ──────────────────────────────────────────────────────────────

/** OAuth 2.0 服务端配置 */
export interface OAuthServerConfig {
  /** 授权端点 */
  authorizationEndpoint: string;
  /** Token 端点 */
  tokenEndpoint: string;
  /** 客户端 ID, 支持 {env:VAR_NAME} 语法 */
  clientId: string;
  /** 客户端密钥 (可选, 用于 PKCE), 支持 {env:VAR_NAME} 语法 */
  clientSecret?: string;
  /** 请求的 OAuth 作用域 */
  scopes: string[];
  /**
   * 将 OAuth token 注入到哪个环境变量中。
   *
   * 仅 local 模式使用此字段：
   * - 设为 "GITHUB_PERSONAL_ACCESS_TOKEN" → 子进程收到的 env 中该变量值为 OAuth access_token
   * - 不设置则按照 remote 模式处理（Bearer header 认证）
   */
  tokenEnvVar?: string;
}

// ── MCP Server 完整入口 ─────────────────────────────────────────────────────

/**
 * MCP Server 完整配置项
 *
 * 设计要点 (对齐 OpenCode):
 * - name: 唯一标识, 同时也是工具前缀
 * - enabled: 是否启用该 server
 * - config: 具体连接配置 (local 或 remote)
 * - 每个 server 独立配置, 不再区分 "内建" 和 "用户自定义"
 */
export interface MCPServerEntry {
  /** 唯一名称 (字母开头, 仅含字母数字下划线横线) */
  name: string;
  /** 描述 */
  description: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 连接配置 (local 或 remote) */
  config: LocalServerConfig | RemoteServerConfig;
}

// ── Agent MCP 工具控制 ──────────────────────────────────────────────────────

/**
 * Agent 级别的工具配置
 *
 * 参照 OpenCode 设计:
 * - tools 字段使用 Glob 模式控制工具可见性
 * - MCP 工具以 `{serverName}_{toolName}` 格式注册
 * - 支持全局禁用 + 特定 agent 启用的策略
 *
 * 示例:
 * ```json
 * {
 *   "tools": {
 *     "github_*": false,      // 全局禁用 github 的所有工具
 *     "figma_*": true         // 全局启用 figma 的所有工具
 *   },
 *   "agent": {
 *     "my-agent": {
 *       "tools": {
 *         "github_*": true    // 仅在 my-agent 中启用 github
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface MCPToolVisibility {
  /** 全局工具可见性 (glob 模式 → 是否启用) */
  tools?: Record<string, boolean>;
  /** 每个 Agent 的工具可见性覆盖 */
  agent?: Record<string, AgentMCPConfig>;
}

export interface AgentMCPConfig {
  /** 该 Agent 的工具可见性覆盖 */
  tools?: Record<string, boolean>;
}

// ── 环境变量解析 ────────────────────────────────────────────────────────────

/**
 * 解析配置值中的 {env:VAR_NAME} 引用
 *
 * 示例:
 * - "{env:GITHUB_TOKEN}" → process.env.GITHUB_TOKEN
 * - "prefix_{env:MY_VAR}_suffix" → "prefix_value_suffix"
 * - 如果环境变量不存在, 替换为空字符串
 *
 * @param value 可能包含 {env:VAR_NAME} 的字符串
 * @returns 解析后的值
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\{env:([^}]+)\}/g, (_match, varName) => {
    return process.env[varName.trim()] ?? '';
  });
}

/**
 * 递归解析对象中所有字符串值的 {env:VAR_NAME} 引用
 */
export function resolveEnvVarsInObject<T extends Record<string, any>>(obj: T): T {
  const result = { ...obj };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      result[key as keyof T] = resolveEnvVars(value) as any;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key as keyof T] = resolveEnvVarsInObject(value);
    }
  }
  return result;
}

// ── 兼容类型 (旧代码过渡) ───────────────────────────────────────────────────

/** @deprecated 使用 LocalServerConfig 替代 */
export interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ── OAuth 运行时类型 ────────────────────────────────────────────────────────

export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

export interface OAuthAuthState {
  serverName: string;
  pkce: PKCEParams;
  config: OAuthServerConfig;
  resolve: (tokens: StoredTokens | null) => void;
  reject: (err: Error) => void;
}

// ── MCP 连接状态 ────────────────────────────────────────────────────────────

/** MCP Server 运行时状态 */
export interface MCPServerStatus {
  /** Server 名称 */
  name: string;
  /** 是否已启用 */
  enabled: boolean;
  /** 配置类型 */
  type: 'local' | 'remote';
  /** 是否已连接 */
  isConnected: boolean;
  /** 已注册的工具数量 */
  toolCount: number;
  /** 已发现的工具名列表 */
  toolNames: string[];
  /** 是否已 OAuth 授权 */
  oauthAuthorized?: boolean;
  /** OAuth 是否需要授权 (仅配置了 oauth 的 server) */
  oauthRequired?: boolean;
  /** 最后错误信息 */
  lastError?: string;
}

// ── Glob 模式匹配 ────────────────────────────────────────────────────────────

/**
 * 检查工具名是否匹配 glob 模式
 *
 * 支持:
 * - * 匹配零个或多个任意字符
 * - ? 匹配恰好一个字符
 *
 * @param toolName 工具全名 (如 "github_search_repositories")
 * @param pattern glob 模式 (如 "github_*")
 */
export function matchGlob(toolName: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
  return regex.test(toolName);
}

/**
 * 根据 visibility 配置判断工具是否对指定 agent 可见
 *
 * 优先级: agent 级别配置 > 全局配置 > 默认可见
 *
 * @param toolName 工具全名
 * @param agentName agent 名称 (null 表示没有特定 agent)
 * @param visibility 全局可见性配置
 */
export function isToolVisible(
  toolName: string,
  agentName: string | null,
  visibility: MCPToolVisibility | null
): boolean {
  if (!visibility) return true;

  // 检查 agent 级别配置 (高优先级)
  if (agentName && visibility.agent?.[agentName]?.tools) {
    const agentTools = visibility.agent[agentName].tools!;
    for (const [pattern, enabled] of Object.entries(agentTools)) {
      if (matchGlob(toolName, pattern)) {
        return enabled;
      }
    }
  }

  // 检查全局配置
  if (visibility.tools) {
    for (const [pattern, enabled] of Object.entries(visibility.tools)) {
      if (matchGlob(toolName, pattern)) {
        return enabled;
      }
    }
  }

  // 默认可见
  return true;
}

// ── 配置格式迁移 (旧格式兼容) ──────────────────────────────────────────────

/**
 * 将旧格式的 MCP 配置标准化为新格式。
 *
 * 旧格式 (v0):
 *   type: 'stdio'
 *   command: 'npx'          ← 单个字符串
 *   args: ['-y', 'pkg']     ← 分离的参数
 *   env: { KEY: 'val' }     ← env 字段名
 *
 * 新格式 (v1, 对齐 OpenCode):
 *   type: 'local'
 *   command: ['npx', '-y', 'pkg']  ← 合并数组
 *   environment: { KEY: 'val' }    ← environment 字段名
 *   timeout?: number
 *
 * 也兼容旧格式的 remote: 以前 remote 没有 headers，现在 headers 是可选的。
 */
export function normalizeServerConfig(
  entry: MCPServerEntry,
): MCPServerEntry {
  const config = entry.config as unknown as Record<string, unknown>;

  // 旧 stdio 类型 → 新 local 类型
  if (config.type === 'stdio') {
    const oldCmd = config.command as string;
    const oldArgs = (config.args ?? []) as string[];
    const oldEnv = (config.env ?? {}) as Record<string, string>;

    return {
      ...entry,
      config: {
        type: 'local' as const,
        command: [oldCmd, ...oldArgs],
        environment: oldEnv,
      },
    };
  }

  // 旧 remote 类型 (无 headers 字段) → 补默认值
  if (config.type === 'remote') {
    return {
      ...entry,
      config: {
        ...(entry.config as RemoteServerConfig),
        // 保持 headers 可选
      },
    };
  }

  // 已经是新格式 (local / remote), 直接返回
  return entry;
}

// ── 默认超时 ────────────────────────────────────────────────────────────────

/** 默认 MCP 工具调用超时 (毫秒) */
export const DEFAULT_MCP_TIMEOUT = 5000;
