/* core/tools/memory-tools — 跨会话记忆管理工具
 *
 * 五项操作合并在一个工具中，用 action 字段区分：
 * - save   — 保存记忆（name + type + content）
 * - list   — 列出所有记忆
 * - search — 关键词搜索记忆
 * - read   — 按文件名读取单条记忆完整内容
 * - delete — 按文件名删除单条记忆
 */

import type { ToolDefinition } from '@/core/tool-registry'
import type { MemoryStore } from '@/core/memory'

/** 创建 memory 工具定义（闭包注入 MemoryStore 实例） */
export function createMemoryTool(memoryStore: MemoryStore): ToolDefinition {
  return {
    name: 'memory',
    description: '管理跨会话记忆。action: save（保存）| list（列表）| search（搜索）| read（读取）| delete（删除）',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'list', 'search', 'read', 'delete'],
          description: '操作类型：save=保存记忆，list=列出所有，search=关键词搜索，read=读取完整内容，delete=删除',
        },
        name: {
          type: 'string',
          description: '记忆名称，简短概括记忆内容（save 时必填）',
        },
        description: {
          type: 'string',
          description: '一句话描述，用于后续检索匹配（save 时建议填写，默认使用 name）',
        },
        type: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: '记忆类型：user=用户偏好，feedback=反馈经验，project=项目知识，reference=参考资料',
        },
        content: {
          type: 'string',
          description: '记忆的完整内容（save 时必填，最长 4000 字符）',
        },
        query: {
          type: 'string',
          description: '搜索关键词，支持空格分隔多个词（search 时必填）',
        },
        filename: {
          type: 'string',
          description: '目标文件名，从 list/search 结果中获取（read/delete 时必填）',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    isConcurrencySafe: false,
    isReadOnly: false,
    shouldDefer: true,
    searchHint: 'memory remember save store recall knowledge persistent',
    execute: async (args: any) => {
      const { action } = args

      switch (action) {
        case 'save': {
          if (!args.name || !args.type || !args.content) {
            return '保存失败：需要 name、type、content 参数。\n示例：memory({ action: "save", name: "用户偏好 TypeScript", type: "user", content: "用户偏好 TypeScript，优先用 TS 写示例代码" })'
          }
          const filename = memoryStore.save({
            name: args.name,
            description: args.description || args.name,
            type: args.type,
            content: args.content,
          })
          return `已保存到记忆: ${filename}`
        }

        case 'list': {
          const entries = memoryStore.list()
          if (entries.length === 0) return '当前没有存储任何记忆。你可以用 memory action: save 保存一条。'
          const lines = entries.map(
            e => `  [${e.type}] ${e.name} | file: ${e.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')} | ${e.description}`,
          )
          return `记忆列表（共 ${entries.length} 条）：\n${lines.join('\n')}`
        }

        case 'search': {
          if (!args.query) return '搜索失败：需要 query 参数。'
          const results = memoryStore.search(args.query)
          if (results.length === 0) return `没有找到与 "${args.query}" 相关的记忆。`
          const lines = results.map(
            e => `  [${e.type}] ${e.name} | file: ${e.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')} | ${e.description}`,
          )
          return `搜索结果（${results.length} 条匹配）：\n${lines.join('\n')}`
        }

        case 'read': {
          if (!args.filename) return '读取失败：需要 filename 参数。可从 list 或 search 结果中获取。'
          const entry = memoryStore.list().find(e => e.filePath.endsWith(args.filename))
          if (!entry) return `未找到文件名为 "${args.filename}" 的记忆。请用 list 或 search 确认文件名是否正确。`
          return `[${entry.type}] ${entry.name}\n描述: ${entry.description}\n\n${entry.content}`
        }

        case 'delete': {
          if (!args.filename) return '删除失败：需要 filename 参数。可从 list 或 search 结果中获取。'
          const entry = memoryStore.list().find(e => e.filePath.endsWith(args.filename))
          if (!entry) return `未找到文件名为 "${args.filename}" 的记忆。`
          const name = entry.name
          memoryStore.delete(name)
          return `已删除记忆: ${name}`
        }

        default:
          return `未知操作: ${action}。支持的操作: save, list, search, read, delete`
      }
    },
  }
}
