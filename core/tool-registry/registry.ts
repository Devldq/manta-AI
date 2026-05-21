import { jsonSchema } from 'ai';

import type { ToolDefinition, MCPClientLike } from './types';
import { truncateResult, DEFAULT_MAX_RESULT_CHARS } from './utils';

/**
 * 工具注册中心 — 统一管理工具的注册、查找和 AI SDK 格式转换
 *
 * 三件事：
 * 1. 注册工具（register）
 * 2. 查找工具（get / getAll）
 * 3. 转换成 AI SDK 需要的格式（toAISDKFormat），含截断保护和并发控制
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private mcpClients: MCPClientLike[] = [];

  // ── 全局读写锁状态 ──────────────────────────────────────────────────────
  private exclusiveLock = false // 当前是否有独占锁持有者
  private concurrentCount = 0 // 当前共享锁持有数
  private waitQueue: Array<() => void> = [] // 阻塞等待中的 resolve 函数

  /** 获取共享锁：只要没人独占就能拿，多个只读工具可以同时持有 */
  private async acquireConcurrent(): Promise<void> {
    while (this.exclusiveLock) {
      await new Promise<void>((r) => this.waitQueue.push(r))
    }
    this.concurrentCount++
  }

  private releaseConcurrent(): void {
    this.concurrentCount--
    if (this.concurrentCount === 0) this.drainQueue()
  }

  /** 获取独占锁：必须等所有共享锁释放、且没人持独占 */
  private async acquireExclusive(): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise<void>((r) => this.waitQueue.push(r))
    }
    this.exclusiveLock = true
  }

  private releaseExclusive(): void {
    this.exclusiveLock = false
    this.drainQueue()
  }

  /** 锁释放时把等待队列全唤醒，让它们重新去抢锁 */
  private drainQueue(): void {
    const waiting = this.waitQueue.splice(0)
    for (const resolve of waiting) resolve()
  }

  // ── 工具管理 ────────────────────────────────────────────────────────────

  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool)
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * 转换为 Vercel AI SDK 工具格式
   * - 将 parameters（JSON Schema 对象）转为 inputSchema
   * - 在 execute 外层包裹截断逻辑
   * - 根据 isConcurrencySafe 加全局读写锁
   */
  toAISDKFormat(): Record<string, any> {
    const result: Record<string, any> = {}
    const registry = this

    for (const [name, tool] of this.tools) {
      const maxChars = tool.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS
      const executeFn = tool.execute
      const isSafe = tool.isConcurrencySafe === true

      result[name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          // 按 isConcurrencySafe 获取锁
          if (isSafe) {
            await registry.acquireConcurrent()
          } else {
            await registry.acquireExclusive()
          }

          try {
            const raw = await executeFn(input)
            if (raw === undefined) {
              return '工具执行返回了 undefined'
            }
            const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
            return truncateResult(text, maxChars)
          } finally {
            // 不管成功还是抛异常，锁都要释放
            if (isSafe) {
              registry.releaseConcurrent()
            } else {
              registry.releaseExclusive()
            }
          }
        },
      }
    }

    return result
  }

  // ── MCP 集成 ────────────────────────────────────────────────────────────

  /**
   * 连接 MCP Server，发现它暴露的工具，然后自动注册到 Registry 里。
   * 每个 MCP 工具的 execute 函数是一个闭包，调用时通过 JSON-RPC 转发给 Server。
   *
   * @param serverName MCP Server 的逻辑名称（如 "github"、"slack"）
   * @param client MCP 客户端实例（需实现 MCPClientLike 接口）
   * @returns 成功注册的工具名前缀列表（格式：mcp__{serverName}__{toolName}）
   */
  async registerMCPServer(
    serverName: string,
    client: MCPClientLike,
  ): Promise<string[]> {
    await client.connect();
    this.mcpClients.push(client);

    const tools = await client.listTools();
    const registered: string[] = [];

    for (const tool of tools) {
      const prefixedName = `mcp__${serverName}__${tool.name}`;
      if (this.tools.has(prefixedName)) continue;

      const toolClient = client;
      const originalName = tool.name;

      this.register({
        name: prefixedName,
        description: `[MCP:${serverName}] ${tool.description}`,
        parameters: tool.inputSchema,
        isConcurrencySafe: true,
        isReadOnly: true,
        maxResultChars: 3000,
        execute: async (input: any) => {
          return toolClient.callTool(originalName, input);
        },
      });

      registered.push(prefixedName);
    }

    return registered;
  }

  /**
   * 关闭所有已连接的 MCP 客户端并清空客户端列表。
   * 注意：已注册的工具不会自动移除，如需完全清理，请创建新的 ToolRegistry 实例。
   */
  async closeAllMCP(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.close();
    }

    this.mcpClients = [];
  }
}
