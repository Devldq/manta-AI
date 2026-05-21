/** 工具定义接口 — 统一工具描述格式 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 对象（未经 jsonSchema() 包装） */
  parameters: Record<string, unknown>;
  /** 是否并发安全（可并行执行）：true=共享锁（可并发），false=独占锁（串行） */
  isConcurrencySafe?: boolean;
  /** 是否只读工具，用于权限控制和提示 */
  isReadOnly?: boolean;
  /** 执行结果最大字符数，超出则截断（默认 3000） */
  maxResultChars?: number;
  /** 工具执行函数，input 为 AI SDK 传入的参数对象 */
  execute: (input: any) => Promise<unknown>;
}

/** MCP Server 暴露的单个工具描述 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 客户端接口 — 任何实现此接口的客户端都可接入 ToolRegistry */
export interface MCPClientLike {
  connect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

// ── MCP Server 配置类型 ────────────────────────────────────────────────────

/** Stdio 模式的 MCP Server 配置 */
export interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Remote HTTP + OAuth 模式的 MCP Server 配置 */
export interface RemoteServerConfig {
  type: 'remote';
  url: string;
  oauth: OAuthServerConfig;
}

/** OAuth 2.0 服务端配置（不含 redirectUri — 使用 Loopback Server 自动分配） */
export interface OAuthServerConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
}

/** MCP Server 完整配置项 */
export interface MCPServerEntry {
  name: string;
  description: string;
  enabled?: boolean;
  config: StdioServerConfig | RemoteServerConfig;
}

// ── OAuth 运行时类型 ───────────────────────────────────────────────────────

/** PKCE 参数 */
export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/** 持久化的 OAuth Token */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number; // Unix 毫秒时间戳
  scope?: string;
}

/** 运行中的 OAuth 授权状态 */
export interface OAuthAuthState {
  serverName: string;
  pkce: PKCEParams;
  config: OAuthServerConfig;
  resolve: (tokens: StoredTokens | null) => void;
  reject: (err: Error) => void;
}
