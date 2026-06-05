/* core/tools/todo — 待办事项工具集
 *
 * 工具列表：
 * - todoRead  — 读取待办事项列表
 * - todoWrite — 写入待办事项列表
 */
import type { ToolDefinition } from '@/core/tool-registry'
import { readTodos, writeTodos } from './utils'

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** TodoRead — 读取待办事项列表 */
function createTodoReadTool(): ToolDefinition {
  return {
    name: 'todoRead',
    description: '读取当前任务的待办事项列表，了解任务进度和待完成项目。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    shouldDefer: true,
    searchHint: 'todo task list read status progress pending',
    execute: async (_input: any) => {
      const todos = readTodos()
      return { todos, count: todos.length }
    },
  }
}

/** TodoWrite — 写入待办事项列表 */
function createTodoWriteTool(): ToolDefinition {
  return {
    name: 'todoWrite',
    description: '更新待办事项列表（覆盖写入）。适合追踪复杂多步任务的进度。每次更新都要包含完整的 todos 列表。',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '完整的待办事项列表（覆盖写入）',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '唯一标识符' },
              content: { type: 'string', minLength: 1, description: '任务内容描述' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: '任务状态',
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: '优先级',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
    isConcurrencySafe: false,
    shouldDefer: true,
    searchHint: 'todo task create update write manage track progress',
    execute: async (input: any) => {
      const { todos } = input
      writeTodos(todos)
      const byStatus = {
        pending: todos.filter((t: any) => t.status === 'pending').length,
        in_progress: todos.filter((t: any) => t.status === 'in_progress').length,
        completed: todos.filter((t: any) => t.status === 'completed').length,
      }
      return { success: true, total: todos.length, byStatus }
    },
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有待办事项工具 */
export function createTodoTools(): ToolDefinition[] {
  return [
    createTodoReadTool(),
    createTodoWriteTool(),
  ]
}
