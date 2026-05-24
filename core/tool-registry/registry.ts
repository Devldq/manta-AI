import { jsonSchema } from 'ai';

import type {
  ToolDefinition,
  MCPClientLike,
  MCPToolVisibility,
} from './types';
import { isToolVisible, DEFAULT_MCP_TIMEOUT } from './types';
import { truncateResult, DEFAULT_MAX_RESULT_CHARS } from './utils';

/**
 * 根据 MCP server 名称和工具信息生成 searchHint。
 *
 * 生成规则（参照 Claude Code）:
 * - 3-10 个词的英文短语，描述工具能做什么
 * - 组合 serverName 关键词 + tool.name 中的关键词 + description 前几个词
 * - 模型不会看到这些 hint，仅在 ToolSearch 内部做关键词匹配
 */
function generateMCPSearchHint(
  serverName: string,
  toolName: string,
  description: string,
): string {
  // 从 description 提取前几个有意义的关键词
  const descWords = description
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|this|that|from|into|over|will|each)$/i.test(w))
    .slice(0, 5);

  // 从 toolName 提取关键词（去掉 server 前缀部分）
  const toolWords = toolName
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  // 合并并去重、限制在 10 个词以内
  const combined = [
    serverName,
    ...new Set([...toolWords, ...descWords]),
  ].filter(Boolean).slice(0, 10);

  return combined.join(' ');
}

/**
 * 工具注册中心 — 统一管理工具的注册、查找和 AI SDK 格式转换
 *
 * 参照 OpenCode 设计重构:
 * 1. 注册工具 (register)
 * 2. 查找工具 (get / getAll / getByAgent)
 * 3. 转换成 AI SDK 需要的格式 (toAISDKFormat / toAISDKFormatForAgent)
 * 4. MCP Server 连接管理 (registerMCPServer / unregisterMCPServer)
 * 5. 全局读写锁 (并发控制)
 *
 * MCP 工具命名规则 (对齐 OpenCode):
 * - 格式: {serverName}_{toolName}
 * - 示例: github_search_repositories
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private mcpClients: MCPClientLike[] = [];
  private mcpServerMap = new Map<string, MCPClientLike>();

  /** 已被 tool_search 发现过的工具名集合 */
  private discoveredTools = new Set<string>();

  // ── 全局读写锁状态 ──────────────────────────────────────────────────────
  private exclusiveLock = false;
  private concurrentCount = 0;
  private waitQueue: Array<() => void> = [];

  /** 获取共享锁 */
  private async acquireConcurrent(): Promise<void> {
    while (this.exclusiveLock) {
      await new Promise<void>((r) => this.waitQueue.push(r));
    }
    this.concurrentCount++;
  }

  private releaseConcurrent(): void {
    this.concurrentCount--;
    if (this.concurrentCount === 0) this.drainQueue();
  }

  /** 获取独占锁 */
  private async acquireExclusive(): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise<void>((r) => this.waitQueue.push(r));
    }
    this.exclusiveLock = true;
  }

  private releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }

  private drainQueue(): void {
    const waiting = this.waitQueue.splice(0);
    for (const resolve of waiting) resolve();
  }

  // ── 工具管理 ────────────────────────────────────────────────────────────

  /** 注册一个或多个工具 */
  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** 移除一个工具 */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 根据名称查找工具 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 获取所有工具 */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** 获取所有非 MCP 工具 */
  getBuiltinTools(): ToolDefinition[] {
    return this.getAll().filter((t) => !t.mcpServer);
  }

  /** 获取指定 MCP Server 注册的所有工具 */
  getMCPTools(serverName: string): ToolDefinition[] {
    return this.getAll().filter((t) => t.mcpServer === serverName);
  }

  /**
   * 根据 agent 获取可见的工具列表
   *
   * 参照 OpenCode 设计:
   * - 支持 glob 模式过滤
   * - 支持 per-agent 工具可见性配置
   *
   * @param agentName agent 名称 (null 表示默认)
   * @param visibility 工具可见性配置
   */
  getByAgent(
    agentName: string | null,
    visibility: MCPToolVisibility | null,
  ): ToolDefinition[] {
    if (!visibility || (!visibility.tools && !visibility.agent)) {
      return this.getAll();
    }

    return this.getAll().filter((tool) => {
      // 非 MCP 工具始终可见
      if (!tool.mcpServer) return true;
      return isToolVisible(tool.name, agentName, visibility);
    });
  }

  /**
   * 获取指定 MCP Server 名称前缀的所有工具名
   */
  getMCPToolNames(serverName: string): string[] {
    const prefix = `${serverName}_`;
    return this.getAll()
      .filter((t) => t.name.startsWith(prefix))
      .map((t) => t.name);
  }

  /**
   * 按精确工具名搜索已注册的工具。
   *
   * 支持逗号分隔一次查多个工具名。
   * 匹配到的工具自动加入 discoveredTools 集合。
   *
   * @param query 工具名（如 "mcp__github__list_issues"），支持逗号分隔多个
   * @returns 匹配的工具定义列表（仅返回 Schema 信息，不包含 execute 函数）
   */
  searchTools(query: string): Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[] {
    const names = query
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    const results: Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[] = [];

    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        this.discoveredTools.add(name);
        results.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        });
      }
    }

    return results;
  }

  /**
   * 生成延迟工具的摘要，用于附加到 System prompt 中。
   *
   * 延迟工具 = 所有非 tool_search 的工具（系统工具 + MCP 工具）。
   * 模型看到这个列表后，可以通过 tool_search 按需获取完整 Schema。
   *
   * 结构：按"系统工具"和"MCP 工具"分类展示，每类包含工具名及简短描述。
   *
   * @returns 格式化的延迟工具摘要字符串
   */
  getDeferredToolSummary(): string {
    const deferred = this.getAll().filter((t) => t.name !== 'tool_search');

    if (deferred.length === 0) return '';

    const systemTools = deferred.filter((t) => !t.mcpServer);
    const mcpTools = deferred.filter((t) => !!t.mcpServer);

    const lines: string[] = [
      '## 可用工具（按需加载）',
      '',
      '以下所有工具的完整 Schema 均未展开。需要调用某个工具时，先用 `tool_search` 获取其完整定义。',
      '',
    ];

    if (systemTools.length > 0) {
      lines.push('### 系统工具', '');
      for (const t of systemTools) {
        const brief = t.description.length > 80
          ? t.description.slice(0, 80) + '...'
          : t.description;
        lines.push(`- **${t.name}**: ${brief}`);
      }
      lines.push('');
    }

    if (mcpTools.length > 0) {
      lines.push('### MCP 工具', '');
      // 按 MCP Server 分组
      const mcpGroups = new Map<string, string[]>();
      for (const t of mcpTools) {
        const server = t.mcpServer!;
        if (!mcpGroups.has(server)) mcpGroups.set(server, []);
        mcpGroups.get(server)!.push(t.name);
      }
      for (const [server, tools] of mcpGroups) {
        lines.push(`#### ${server}`, '');
        for (const name of tools) {
          lines.push(`- ${name}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取已被 tool_search 发现过的工具名列表。
   */
  getDiscoveredTools(): string[] {
    return Array.from(this.discoveredTools);
  }

  /**
   * 转换为 Vercel AI SDK 工具格式（延迟加载版本）
   *
   * 策略：
   * - 始终包含 tool_search 工具
   * - 只包含已发现的工具（discoveredTools）
   * - 其他所有工具都延迟加载
   */
  toAISDKFormat(): Record<string, any> {
    const discovered = new Set(this.getDiscoveredTools());

    const tools = this.getAll().filter((t) => {
      // 始终包含 tool_search
      if (t.name === 'tool_search') return true;

      // 包含已发现的工具
      if (discovered.has(t.name)) return true;

      // 其他工具不包含（延迟加载）
      return false;
    });

    return this.buildAISDKTools(tools);
  }

  /**
   * 根据 agent 转换为 Vercel AI SDK 工具格式（延迟加载版本）
   *
   * @param agentName agent 名称
   * @param visibility 工具可见性配置
   */
  toAISDKFormatForAgent(
    agentName: string | null,
    visibility: MCPToolVisibility | null,
  ): Record<string, any> {
    const agentTools = this.getByAgent(agentName, visibility);
    const discovered = new Set(this.getDiscoveredTools());

    const tools = agentTools.filter((t) => {
      // 始终包含 tool_search
      if (t.name === 'tool_search') return true;

      // 包含已发现的工具
      if (discovered.has(t.name)) return true;

      // 其他工具不包含（延迟加载）
      return false;
    });

    return this.buildAISDKTools(tools);
  }

  /**
   * 构建 AI SDK 格式的工具映射
   *
   * - 将 parameters (JSON Schema 对象) 转为 inputSchema
   * - 在 execute 外层包裹截断逻辑
   * - 根据 isConcurrencySafe 加全局读写锁
   */
  private buildAISDKTools(toolList: ToolDefinition[]): Record<string, any> {
    const result: Record<string, any> = {};
    const registry = this;

    for (const tool of toolList) {
      const maxChars = tool.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
      const executeFn = tool.execute;
      const isSafe = tool.isConcurrencySafe === true;

      result[tool.name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          // 工具调用日志
          const logPrefix = tool.mcpServer ? `[MCP:${tool.mcpServer}]` : '[Tool]';
          console.log(`${logPrefix} 调用 ${tool.name}`, JSON.stringify(input).slice(0, 200));

          if (isSafe) {
            await registry.acquireConcurrent();
          } else {
            await registry.acquireExclusive();
          }

          const startTime = Date.now();
          try {
            const raw = await executeFn(input);
            const elapsed = Date.now() - startTime;
            if (raw === undefined) {
              console.warn(`${logPrefix} ${tool.name} 返回了 undefined (${elapsed}ms)`);
              return '工具执行返回了 undefined';
            }
            const text =
              typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            const truncated = truncateResult(text, maxChars);
            console.log(`${logPrefix} ${tool.name} 完成 (${elapsed}ms, ${text.length} 字符${text !== truncated ? ', 已截断' : ''})`);
            return truncated;
          } catch (err) {
            const elapsed = Date.now() - startTime;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`${logPrefix} ${tool.name} 执行失败 (${elapsed}ms): ${msg}`);
            // 返回错误信息而非抛出异常，确保 AI SDK 始终获得 tool-result，
            // 避免因缺少 tool-result 导致 "Tool result is missing" 错误
            return `工具执行出错：${msg}`;
          } finally {
            if (isSafe) {
              registry.releaseConcurrent();
            } else {
              registry.releaseExclusive();
            }
          }
        },
      };
    }

    return result;
  }

  // ── MCP 集成 ────────────────────────────────────────────────────────────

  /**
   * 连接 MCP Server，发现它暴露的工具，然后自动注册到 Registry 里。
   *
   * 每个 MCP 工具的 execute 函数是一个闭包，调用时通过 JSON-RPC 转发给 Server。
   *
   * 工具命名规则 (对齐 OpenCode):
   * - 前缀: {serverName}_
   * - 完整名: {serverName}_{toolName}
   * - 示例: github_search_repositories
   *
   * @param serverName MCP Server 的逻辑名称
   * @param client MCP 客户端实例
   * @returns 成功注册的工具名前缀列表
   */
  async registerMCPServer(
    serverName: string,
    client: MCPClientLike,
  ): Promise<string[]> {
    await client.connect();
    this.mcpClients.push(client);
    this.mcpServerMap.set(serverName, client);

    const tools = await client.listTools();
    const registered: string[] = [];

    for (const tool of tools) {
      // 工具命名: {serverName}_{toolName} (对齐 OpenCode)
      const prefixedName = `${serverName}_${tool.name}`;
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
        mcpServer: serverName,
        mcpToolName: originalName,
        shouldDefer: true,
        searchHint: generateMCPSearchHint(serverName, tool.name, tool.description),
        execute: async (input: any) => {
          return toolClient.callTool(originalName, input);
        },
      });

      registered.push(prefixedName);
    }

    return registered;
  }

  /**
   * 断开并卸载指定的 MCP Server。
   *
   * 1. 关闭客户端连接
   * 2. 移除该 server 注册的所有工具 (前缀: {serverName}_)
   * 3. 从 mcpServerMap 和 mcpClients 中清理
   *
   * @param serverName MCP Server 名称
   * @returns 被移除的工具数量，如果 server 未连接则返回 0
   */
  async unregisterMCPServer(serverName: string): Promise<number> {
    const client = this.mcpServerMap.get(serverName);
    if (!client) return 0;

    // 关闭连接
    try {
      await client.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ToolRegistry] 关闭 ${serverName} 连接时出错: ${msg}`);
    }

    // 移除该 server 的所有工具 (前缀: {serverName}_)
    const prefix = `${serverName}_`;
    let removedCount = 0;
    for (const key of this.tools.keys()) {
      if (key.startsWith(prefix)) {
        this.tools.delete(key);
        removedCount++;
      }
    }

    // 清理 client 追踪
    this.mcpServerMap.delete(serverName);
    const clientIndex = this.mcpClients.indexOf(client);
    if (clientIndex >= 0) {
      this.mcpClients.splice(clientIndex, 1);
    }

    return removedCount;
  }

  /** 检查指定 MCP Server 是否已连接注册 */
  isMCPServerConnected(serverName: string): boolean {
    return this.mcpServerMap.has(serverName);
  }

  /** 获取所有已连接的 MCP Server 名称 */
  getConnectedMCPServers(): string[] {
    return Array.from(this.mcpServerMap.keys());
  }

  /**
   * 关闭所有已连接的 MCP 客户端并移除所有 MCP 工具。
   *
   * 清理策略 (双保险, 同时兼容旧新版前缀):
   * - 新格式: tool.mcpServer 字段不为空
   * - 旧格式: key 以 mcp__ 开头 (v0 前缀)
   * - 新格式: key 包含 _{serverName}_ (v1 前缀, 如 github_search_repositories)
   */
  async closeAllMCP(): Promise<void> {
    for (const client of this.mcpClients) {
      try {
        await client.close();
      } catch {
        // 忽略关闭错误
      }
    }

    // 移除所有 MCP 工具 (双策略匹配)
    const mcpServerNames = Array.from(this.mcpServerMap.keys());
    for (const [key, tool] of this.tools.entries()) {
      // 策略1: 新格式 mcpServer 字段
      if (tool.mcpServer) {
        this.tools.delete(key);
        continue;
      }
      // 策略2: 旧格式 mcp__ 前缀
      if (key.startsWith('mcp__')) {
        this.tools.delete(key);
        continue;
      }
      // 策略3: 新格式 {serverName}_ 前缀
      if (mcpServerNames.some((name) => key.startsWith(`${name}_`))) {
        this.tools.delete(key);
      }
    }

    this.mcpClients = [];
    this.mcpServerMap.clear();
  }
}
