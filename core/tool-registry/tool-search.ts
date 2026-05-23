/**
 * ToolSearch — 延迟工具的"元工具"
 *
 * tool_search 不执行任何业务操作，只做一件事：
 * 根据关键词搜索已注册的工具，返回匹配工具的完整 Schema。
 *
 * 工作原理:
 * 1. System prompt 中通过 getDeferredToolSummary() 列出所有延迟工具名
 * 2. 模型看到列表后，调用 tool_search 传入工具名获取完整 Schema
 * 3. 匹配到的工具自动加入 discoveredTools 集合
 */
import type { ToolDefinition } from './types';
import type { ToolRegistry } from './registry';

/**
 * 创建 tool_search 工具定义。
 *
 * @param registry ToolRegistry 实例（闭包捕获）
 */
export function createToolSearchTool(registry: ToolRegistry): ToolDefinition {
  return {
    name: 'tool_search',
    description:
      '获取延迟工具的完整定义。传入工具名（从系统提示的延迟工具列表中选取），返回该工具的完整参数 Schema。支持逗号分隔多个工具名。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '工具名，如 "github_list_issues"。支持逗号分隔多个工具名，如 "github_list_issues,github_create_issue"',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    execute: async ({ query }: { query: string }) => {
      const results = registry.searchTools(query);

      if (results.length === 0) {
        return `没有找到匹配 "${query}" 的工具。请检查 System prompt 中的延迟工具列表，确认工具名是否正确。`;
      }

      return results;
    },
  };
}
