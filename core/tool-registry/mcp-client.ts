/**
 * MCP 客户端实现 — 基于 @modelcontextprotocol/sdk 的真实 MCP Client 和 Mock 降级客户端。
 *
 * - MCPClient: stdio 子进程模式（现有）
 * - RemoteMCPClient: Remote HTTP 模式（OAuth Bearer Token 注入）
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { MCPClientLike, MCPTool } from './types';

// ── 真实 MCP Client（基于官方 SDK）────────────────────────────────────────

/**
 * 基于 @modelcontextprotocol/sdk 的 MCP 客户端。
 * 通过 StdioClientTransport 启动 MCP Server 进程，使用标准 MCP 协议通信。
 *
 * SDK 自动处理：initialize 握手、JSON-RPC 编解码、请求/响应匹配、
 * 超时重试、stderr 路由等底层细节。
 */
export class MCPClient implements MCPClientLike {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    command: string,
    args: string[] = [],
    env: Record<string, string> = {},
  ) {
    this.command = command;
    this.args = args;
    this.env = env;
  }

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
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

    // SDK 自动执行 initialize 握手
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('MCP 客户端未连接');
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    if (!this.client) throw new Error('MCP 客户端未连接');

    const result = (await this.client.callTool({
      name,
      arguments: input as Record<string, unknown>,
    })) as unknown as {
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };

    // MCP 协议：工具返回 content 数组
    if (result.content && result.content.length > 0) {
      const textParts = result.content
        .filter(
          (c): c is { type: 'text'; text: string } =>
            c.type === 'text' && !!c.text,
        )
        .map((c) => c.text)
        .join('\n');

      if (result.isError) {
        throw new Error(textParts || 'MCP 工具执行返回错误');
      }

      return textParts;
    }

    return JSON.stringify(result);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}

// ── Remote HTTP MCP Client ────────────────────────────────────────────────

/**
 * Remote HTTP MCP Client — 通过 StreamableHTTPClientTransport 连接远程 MCP Server。
 *
 * 每次 connect() 时通过 tokenProvider 回调获取最新的 access_token，
 * 注入到 HTTP 请求头 Authorization: Bearer {token} 中。
 *
 * SDK 自动处理：initialize 握手、JSON-RPC 编解码、请求/响应匹配、SSE 重连。
 */
export class RemoteMCPClient implements MCPClientLike {
  private url: string;
  private tokenProvider: () => Promise<string | null>;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  /**
   * @param url MCP Server 的 Streamable HTTP 端点
   * @param tokenProvider 每次连接时调用的 token 获取函数
   */
  constructor(
    url: string,
    tokenProvider: () => Promise<string | null>,
  ) {
    this.url = url;
    this.tokenProvider = tokenProvider;
  }

  async connect(): Promise<void> {
    const token = await this.tokenProvider();
    if (!token) {
      throw new Error('[RemoteMCPClient] 未获取到有效的 access_token，请先完成 OAuth 授权');
    }

    const requestInit: RequestInit = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

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
    if (!this.client) throw new Error('RemoteMCPClient 未连接');
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    if (!this.client) throw new Error('RemoteMCPClient 未连接');

    const result = (await this.client.callTool({
      name,
      arguments: input as Record<string, unknown>,
    })) as unknown as {
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };

    if (result.content && result.content.length > 0) {
      const textParts = result.content
        .filter(
          (c): c is { type: 'text'; text: string } =>
            c.type === 'text' && !!c.text,
        )
        .map((c) => c.text)
        .join('\n');

      if (result.isError) {
        throw new Error(textParts || 'Remote MCP 工具执行返回错误');
      }

      return textParts;
    }

    return JSON.stringify(result);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}

// ── Mock MCP Client ──────────────────────────────────────────────────────

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
