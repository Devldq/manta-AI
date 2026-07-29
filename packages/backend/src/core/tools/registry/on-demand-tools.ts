import type { ToolDefinition } from './types'
import type { ToolRegistry } from './registry'

export interface SkillCatalogEntry {
  id: string
  name: string
  description: string
}

export interface LoadedSkill extends SkillCatalogEntry {
  content: string
  parameters?: unknown
  tools?: unknown
}

interface OnDemandToolOptions {
  registry: ToolRegistry
  deferredTools: ToolDefinition[]
  /** MCP 可在 Conversation 建立后完成连接；新能力只能通过 Messages 动态发现。 */
  resolveDeferredTools?: () => ToolDefinition[]
  skills: SkillCatalogEntry[]
  loadSkill: (id: string) => LoadedSkill | null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').trim()
}

function scoreMatch(query: string, fields: string[]): number {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return 0
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const haystack = normalize(fields.join(' '))
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1
  }
  if (fields.some(field => normalize(field) === normalizedQuery)) score += 10
  return score
}

/**
 * 创建当前 Agent Run 的按需能力桥。
 *
 * deferredTools/skills 是 Run 启动时的固定目录；搜索结果和完整正文作为
 * tool result 进入 Messages，不修改已经冻结的工具 Schema。
 */
export function createOnDemandTools(options: OnDemandToolOptions): ToolDefinition[] {
  const skillById = new Map(options.skills.map(skill => [skill.id, skill]))
  const discoveredTools = new Set<string>()
  const availableDeferredTools = (): ToolDefinition[] => {
    const tools = options.resolveDeferredTools?.() ?? options.deferredTools
    return [...new Map(tools.map(tool => [tool.name, tool])).values()]
  }

  const toolSearch: ToolDefinition = {
    name: 'tool_search',
    description: '按名称或能力搜索当前 Run 的按需工具，并返回匹配工具的完整参数 Schema。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '工具名或能力关键词，例如 github issue、web search、memory。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    maxResultChars: 12_000,
    execute: async ({ query }: { query: string }) => {
      const matches = availableDeferredTools()
        .map(tool => ({
          tool,
          score: scoreMatch(query, [
            tool.name,
            tool.description,
            tool.searchHint ?? '',
            tool.mcpServer ?? '',
          ]),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, 5)

      for (const match of matches) discoveredTools.add(match.tool.name)

      return matches.length > 0
        ? matches.map(({ tool }) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          }))
        : `没有找到匹配 "${query}" 的按需工具。`
    },
  }

  const toolInvoke: ToolDefinition = {
    name: 'tool_invoke',
    description: '执行已经通过 tool_search 加载的按需工具。核心工具应直接调用，不经过此桥。',
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'tool_search 返回的精确工具名。',
        },
        arguments: {
          type: 'object',
          description: '严格按照 tool_search 返回 Schema 组织的参数。',
          additionalProperties: true,
        },
      },
      required: ['toolName', 'arguments'],
      additionalProperties: false,
    },
    managesOwnConcurrency: true,
    execute: async ({ toolName, arguments: args }: { toolName: string; arguments: Record<string, unknown> }) => {
      if (!availableDeferredTools().some(tool => tool.name === toolName)) {
        return `工具 ${toolName} 不在当前 Run 的按需工具目录中。`
      }
      if (!discoveredTools.has(toolName)) {
        return `工具 ${toolName} 尚未加载。请先调用 tool_search 获取它的完整 Schema。`
      }
      return options.registry.executeRegisteredTool(toolName, args)
    },
  }

  const skillSearch: ToolDefinition = {
    name: 'skill_search',
    description: '按名称或能力搜索当前 Run 可用的 Skill，并把匹配 Skill 的完整正文加载到 Messages。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Skill 名称、ID 或能力关键词。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    maxResultChars: 16_000,
    execute: async ({ query }: { query: string }) => {
      const matches = options.skills
        .map(skill => ({
          skill,
          score: scoreMatch(query, [skill.id, skill.name, skill.description]),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .slice(0, 3)

      if (matches.length === 0) return `没有找到匹配 "${query}" 的 Skill。`

      return matches.map(({ skill }) => {
        const loaded = skillById.has(skill.id) ? options.loadSkill(skill.id) : null
        return loaded ?? {
          ...skill,
          content: 'Skill 正文当前不可用。',
        }
      })
    },
  }

  return [toolSearch, toolInvoke, skillSearch]
}
