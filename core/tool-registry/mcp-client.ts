/**
 * MCP 客户端实现 — 基于 @modelcontextprotocol/sdk
 *
 * 参照 OpenCode 设计重构:
 * - MCPClient: local 子进程模式 (原 stdio)
 * - RemoteMCPClient: remote HTTP 模式 (支持 headers 认证 + OAuth)
 * - 统一的异常处理和超时控制
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { MCPClientLike, MCPTool, LocalServerConfig, RemoteServerConfig } from './types';
import { DEFAULT_MCP_TIMEOUT } from './types';

// ── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 从 MCP SDK 的 tools 结果转换为 MCPTool 列表
 */
function mapToolsToList(result: Awaited<ReturnType<Client['listTools']>>): MCPTool[] {
  return (result.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}

/**
 * 从 CallToolResult 中提取文本内容
 */
function extractToolContent(
  rawResult: unknown,
  serverType: string,
): string {
  const result = rawResult as {
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  };

  if (result.content && result.content.length > 0) {
    const textParts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && !!c.text)
      .map((c) => c.text)
      .join('\n');

    if (result.isError) {
      throw new Error(textParts || `${serverType} MCP 工具执行返回错误`);
    }

    return textParts;
  }

  return JSON.stringify(result);
}

// ── 本地 MCP Client (Local/Stdio 模式) ─────────────────────────────────────

/**
 * 本地 MCP 客户端 (type: "local")
 *
 * 通过 @modelcontextprotocol/sdk 的 StdioClientTransport 启动 MCP Server 子进程，
 * 使用标准 MCP 协议通过 STDIO 通信。
 *
 * SDK 自动处理: initialize 握手、JSON-RPC 编解码、请求/响应匹配、stderr 路由。
 */
export class MCPClient implements MCPClientLike {
  private command: string[];
  private env: Record<string, string>;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private timeout: number;

  /**
   * @param config 本地 MCP Server 配置
   */
  constructor(config: Pick<LocalServerConfig, 'command' | 'environment' | 'timeout'>) {
    this.command = config.command;
    this.env = config.environment ?? {};
    this.timeout = config.timeout ?? DEFAULT_MCP_TIMEOUT;
  }

  async connect(): Promise<void> {
    const [cmd, ...args] = this.command;

    this.transport = new StdioClientTransport({
      command: cmd,
      args,
      env: { ...process.env, ...this.env } as Record<string, string>,
      stderr: 'pipe',
    });

    // 监听 stderr 用于调试
    const stderrStream = this.transport.stderr;
    if (stderrStream) {
      stderrStream.on('data', (data: Buffer) => {
        const lines = data.toString().trim();
        if (lines) {
          console.debug(`[MCP:stderr] ${lines}`);
        }
      });
    }

    this.client = new Client(
      { name: 'manta-tool-registry', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('local MCP 客户端未连接');

    const result = await this.client.listTools();
    return mapToolsToList(result);
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    if (!this.client) throw new Error('local MCP 客户端未连接');

    const result = await this.client.callTool({
      name,
      arguments: input as Record<string, unknown>,
    });

    return extractToolContent(result, 'local');
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}

// ── Remote HTTP MCP Client ──────────────────────────────────────────────────

/**
 * Remote HTTP MCP Client (type: "remote")
 *
 * 通过 @modelcontextprotocol/sdk 的 StreamableHTTPClientTransport 连接远程 MCP Server。
 *
 * 支持两种认证方式:
 * 1. headers: 简单 API Key / Bearer Token 认证 (通过 headers 字段传入)
 * 2. OAuth: 通过 tokenProvider 回调获取 OAuth Bearer Token
 *
 * 如果同时配置 headers 和 tokenProvider，headers 会作为基础请求头，
 * tokenProvider 提供的 Authorization 会覆盖 headers 中的 Authorization。
 */
export class RemoteMCPClient implements MCPClientLike {
  private url: string;
  private headers: Record<string, string>;
  private tokenProvider: (() => Promise<string | null>) | null;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private timeout: number;

  /**
   * @param url MCP Server 的 Streamable HTTP 端点
   * @param options 认证选项
   */
  constructor(
    url: string,
    options: {
      /** 自定义请求头 (用于 API Key 等简单认证) */
      headers?: Record<string, string>;
      /** OAuth token 获取函数 (如果配置, 会在每次连接时调用) */
      tokenProvider?: (() => Promise<string | null>) | null;
      /** 超时 (毫秒) */
      timeout?: number;
    } = {},
  ) {
    this.url = url;
    this.headers = options.headers ?? {};
    this.tokenProvider = options.tokenProvider ?? null;
    this.timeout = options.timeout ?? DEFAULT_MCP_TIMEOUT;
  }

  async connect(): Promise<void> {
    // 构建请求头
    const headers: Record<string, string> = { ...this.headers };

    // 如果有 tokenProvider，获取 OAuth token 并设置 Authorization
    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      if (!token) {
        throw new Error(
          '[RemoteMCPClient] 未获取到有效的 access_token，请先完成 OAuth 授权',
        );
      }
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestInit: RequestInit = { headers };

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.url),
      { requestInit },
    );

    this.client = new Client(
      { name: 'manta-tool-registry', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Remote MCP 客户端未连接');

    const result = await this.client.listTools();
    return mapToolsToList(result);
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    if (!this.client) throw new Error('Remote MCP 客户端未连接');

    const result = await this.client.callTool({
      name,
      arguments: input as Record<string, unknown>,
    });

    return extractToolContent(result, 'remote');
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}

// ── Mock MCP Client ─────────────────────────────────────────────────────────

/**
 * Mock MCP 客户端 — 当无法 spawn 进程时降级使用。
 * 返回空工具列表，方便开发和测试。
 */
export class MockMCPClient implements MCPClientLike {
  async connect(): Promise<void> {
    // Mock 不需要真实连接
  }

  async listTools(): Promise<MCPTool[]> {
    return [];
  }

  async callTool(_name: string, _input: unknown): Promise<unknown> {
    return `[Mock] 工具 "${_name}" 不可用 — MCP Server 未连接。`;
  }

  async close(): Promise<void> {
    // Mock 不需要断开连接
  }
}

// ── 工厂函数 ────────────────────────────────────────────────────────────────

/**
 * 根据 MCP Server 配置创建对应的客户端实例
 *
 * @param config MCP Server 配置 (local 或 remote)
 * @param oauthTokenProvider OAuth token 获取函数 (仅 remote 模式需要)
 */
export function createMCPClient(
  config: LocalServerConfig | RemoteServerConfig,
  oauthTokenProvider?: (serverName: string) => Promise<string | null>,
): MCPClientLike {
  if (config.type === 'local') {
    return new MCPClient(config);
  } else {
    // remote 模式
    const hasOAuth = !!config.oauth;
    const hasHeaders = !!config.headers && Object.keys(config.headers).length > 0;

    return new RemoteMCPClient(config.url, {
      headers: hasHeaders ? config.headers : undefined,
      tokenProvider: hasOAuth && oauthTokenProvider
        ? () => oauthTokenProvider(config.url) // TODO: 这里需要 serverName, 但目前只有 url
        : null,
      timeout: config.timeout,
    });
  }
}
