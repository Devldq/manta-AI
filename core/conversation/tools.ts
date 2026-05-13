/* 会话管理工具集 — 供 AI 模型通过 function calling 使用 */
import { tool, jsonSchema } from 'ai'
import {
  createConversation,
  listConversations,
  getConversation,
  appendMessage,
  deleteConversation,
  updateConversationAgent,
} from './store'

/** 创建新会话 */
export const createConversationTool = tool({
  description:
    '创建一个新的聊天会话。当用户想开始新话题、与特定 Agent 对话或需要独立上下文时调用。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ agentName: string; title?: string }>({
    type: 'object',
    properties: {
      agentName: { type: 'string', description: '关联的 Agent 名称（ID 或名字）' },
      title: { type: 'string', description: '会话标题，不传则默认"新对话"' },
    },
    required: ['agentName'],
  }),
  execute: async ({ agentName, title }) => {
    const conv = createConversation(agentName, title)
    return {
      id: conv.id,
      title: conv.title,
      agentName: conv.agentName,
      createdAt: conv.createdAt,
    }
  },
})

/** 获取会话列表 */
export const listConversationsTool = tool({
  description:
    '查询所有聊天会话列表，按最近更新时间倒序排列。当用户询问"有哪些对话"、"历史记录"、"最近的会话"时调用。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ limit?: number }>({
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
  }),
  execute: async ({ limit }) => {
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
})

/** 获取单个会话详情（含消息记录） */
export const getConversationTool = tool({
  description:
    '根据会话 ID 获取完整的会话详情，包括所有历史消息。当用户想查看某段对话内容、回顾上下文时调用。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ id: string }>({
    type: 'object',
    properties: {
      id: { type: 'string', description: '会话 ID' },
    },
    required: ['id'],
  }),
  execute: async ({ id }) => {
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
})

/** 向会话追加一条消息 */
export const appendMessageTool = tool({
  description:
    '向指定会话追加一条消息（user 或 assistant 角色）。当需要向已有会话写入新消息、记录对话内容时调用。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ conversationId: string; role: 'user' | 'assistant'; content: string }>({
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '目标会话 ID' },
      role: { type: 'string', enum: ['user', 'assistant'], description: '消息角色' },
      content: { type: 'string', minLength: 1, description: '消息文本内容' },
    },
    required: ['conversationId', 'role', 'content'],
  }),
  execute: async ({ conversationId, role, content }) => {
    const result = appendMessage(conversationId, role, content)
    if (!result) return { error: `会话 ${conversationId} 不存在` }
    return {
      messageId: result.message.id,
      role: result.message.role,
      timestamp: result.message.timestamp,
      conversationTitle: result.conv.title,
    }
  },
})

/** 更新会话关联的 Agent */
export const updateConversationAgentTool = tool({
  description:
    '切换会话关联的 Agent。当用户想更换当前对话使用的 Agent、切换助手角色时调用。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ conversationId: string; agentName: string }>({
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '目标会话 ID' },
      agentName: { type: 'string', description: '新的 Agent 名称（ID 或名字）' },
    },
    required: ['conversationId', 'agentName'],
  }),
  execute: async ({ conversationId, agentName }) => {
    const conv = updateConversationAgent(conversationId, agentName)
    if (!conv) return { error: `会话 ${conversationId} 不存在` }
    return {
      id: conv.id,
      agentName: conv.agentName,
      updatedAt: conv.updatedAt,
    }
  },
})

/** 删除会话 */
export const deleteConversationTool = tool({
  description:
    '永久删除指定会话及其所有消息记录。当用户明确要求删除、清除某段对话历史时调用。此操作不可恢复。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ conversationId: string }>({
    type: 'object',
    properties: {
      conversationId: { type: 'string', description: '要删除的会话 ID' },
    },
    required: ['conversationId'],
  }),
  execute: async ({ conversationId }) => {
    const ok = deleteConversation(conversationId)
    return ok
      ? { success: true, message: `会话 ${conversationId} 已删除` }
      : { success: false, error: `会话 ${conversationId} 不存在` }
  },
})

/** 导出所有工具，便于批量注入 streamText */
export const conversationTools = {
  createConversation: createConversationTool,
  listConversations: listConversationsTool,
  getConversation: getConversationTool,
  appendMessage: appendMessageTool,
  updateConversationAgent: updateConversationAgentTool,
  deleteConversation: deleteConversationTool,
}
