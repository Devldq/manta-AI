import { jsonSchema } from 'ai';

import type { ToolDefinition } from './types';
import { truncateResult, DEFAULT_MAX_RESULT_CHARS } from './utils';

/**
 * 工具注册中心 — 统一管理工具的注册、查找和 AI SDK 格式转换
 *
 * 三件事：
 * 1. 注册工具（register）
 * 2. 查找工具（get / getAll）
 * 3. 转换成 AI SDK 需要的格式（toAISDKFormat），含截断保护
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** 注册一个或多个工具 */
  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** 按名称查找工具 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册工具 */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 转换为 Vercel AI SDK 工具格式
   * - 将 parameters（JSON Schema 对象）转为 inputSchema
   * - 在 execute 外层包裹截断逻辑
   */
  toAISDKFormat(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, tool] of this.tools) {
      const maxChars = tool.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
      const executeFn = tool.execute;

      result[name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          const raw = await executeFn(input);
          const text =
            typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
          return truncateResult(text, maxChars);
        },
      };
    }

    return result;
  }
}
