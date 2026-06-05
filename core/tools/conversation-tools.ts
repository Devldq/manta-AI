/* 会话管理工具集 — 使用 ToolDefinition 接口定义，供 ToolRegistry 管理 */
import type { ToolDefinition } from '@/core/tool-registry'
import {
  createConversation,
  listConversations,
  getConversation,
  appendMessage,
  deleteConversation,
  updateConversationAgent,
} from '@/core/conversation/store'

/** 创建新会话 */
const createConversationDef: ToolDefinition = {
  name: 'createConversation',
  description:
    '创建一个新的聊天会话。当用户想开始新话题、与特定 Agent 对话或需要独立上下文时调用。',
  parameters: {
    type: 'object',
    properties: {
      agentName: { type: 'string', description: '关联的 Agent 名称（ID 或名字）' },
      title: { type: 'string', description: '会话标题，不传则默认"新对话"' },
    },
    required: ['agentName'],
  },
  shouldDefer: true,
  searchHint: 'create new chat conversation session start begin',
  execute: async (input: any) => {
    const { agentName, title } = input
    const conv = createConversation(agentName, title)
    return {
      id: conv.id,
      title: conv.title,
      agentName: conv.agentName,
      createdAt: conv.createdAt,
    }
  },
}

/** 获取会话列表 */
const listConversationsDef: ToolDefinition = {
  name: 'listConversations',
  description:
    '查询所有聊天会话列表，按最近更新时间倒序排列。当用户询问"有哪些对话"、"历史记录"、"最近的会话"时调用。',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: '最多返回条数，默认返回全部',
      },
    },
    required: [],
  },
  shouldDefer: true,
  searchHint: 'list conversations history sessions browse chat recent',
  execute: async (input: any) => {
    const { limit } = input
    const list = listConversations()
    const result = limit ? list.slice(0, limit) : list
    return result.map((c) => ({
      id: c.id,
      title: c.title,
      agentName: c.agentName,
      messageCount: c.messages.length,
      updatedAt: c.updatedAt,
    }))
  },
}

/** 获取单个会话详情（含消息记录） */
const getConversationDef: ToolDefinition = {
  name: 'getConversation',
  description:
    '根据会话 ID 获取完整的会话详情，包括所有历史消息。当用户想查看某段对话内容、回顾上下文时调用。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '会话 ID' },
    },
    required: ['id'],
  },
  shouldDefer: true,
  searchHint: 'get conversation detail messages history view retrieve',
  execute: async (input: any) => {
    const { id } = input
    const conv = getConversation(id)
    if (!conv) return { error: `会话 ${id} 不存在` }
    return {
      id: conv.id,
      title: conv.title,
      agentName: conv.agentName,
      messages: conv.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }
  },
}

/** 向会话追加一条消息 */
const appendMessageDef: ToolDefinition = {
  name: 'appendMessage',
  description:
    '向指定会话追加一条消息（user 或 assistant 角色）。当需要向已有会话写入新消息、记录对话内容时调用。',
  parameters: {
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '目标会话 ID' },
      role: { type: 'string', enum: ['user', 'assistant'], description: '消息角色' },
      content: { type: 'string', minLength: 1, description: '消息文本内容' },
    },
    required: ['conversationId', 'role', 'content'],
  },
  shouldDefer: true,
  searchHint: 'append add message to conversation write record',
  execute: async (input: any) => {
    const { conversationId, role, content } = input
    const result = appendMessage(conversationId, role, content)
    if (!result) return { error: `会话 ${conversationId} 不存在` }
    return {
      messageId: result.message.id,
      role: result.message.role,
      timestamp: result.message.timestamp,
      conversationTitle: result.conv.title,
    }
  },
}

/** 更新会话关联的 Agent */
const updateConversationAgentDef: ToolDefinition = {
  name: 'updateConversationAgent',
  description:
    '切换会话关联的 Agent。当用户想更换当前对话使用的 Agent、切换助手角色时调用。',
  parameters: {
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '目标会话 ID' },
      agentName: { type: 'string', description: '新的 Agent 名称（ID 或名字）' },
    },
    required: ['conversationId', 'agentName'],
  },
  shouldDefer: true,
  searchHint: 'switch change update agent conversation session role',
  execute: async (input: any) => {
    const { conversationId, agentName } = input
    const conv = updateConversationAgent(conversationId, agentName)
    if (!conv) return { error: `会话 ${conversationId} 不存在` }
    return {
      id: conv.id,
      agentName: conv.agentName,
      updatedAt: conv.updatedAt,
    }
  },
}

/** 删除会话 */
const deleteConversationDef: ToolDefinition = {
  name: 'deleteConversation',
  description:
    '永久删除指定会话及其所有消息记录。当用户明确要求删除、清除某段对话历史时调用。此操作不可恢复。',
  parameters: {
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '要删除的会话 ID' },
    },
    required: ['conversationId'],
  },
  shouldDefer: true,
  searchHint: 'delete remove conversation session permanently clear history',
  execute: async (input: any) => {
    const { conversationId } = input
    const ok = deleteConversation(conversationId)
    return ok
      ? { success: true, message: `会话 ${conversationId} 已删除` }
      : { success: false, error: `会话 ${conversationId} 不存在` }
  },
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有会话管理工具 */
export function createConversationTools(): ToolDefinition[] {
  return [
    createConversationDef,
    listConversationsDef,
    getConversationDef,
    appendMessageDef,
    updateConversationAgentDef,
    deleteConversationDef,
  ]
}

/** @deprecated 使用 createConversationTools() 工厂函数替代 */
export const conversationToolDefs: ToolDefinition[] = createConversationTools()
