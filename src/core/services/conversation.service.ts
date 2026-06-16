import type { Conversation, ConversationMessage, ConversationType, CreateConversationInput } from '@/core/types'
import {
  createConversation,
  listConversations,
  getConversation,
  deleteConversation,
  appendMessage,
} from '@/core/storage/conversation/store'
import {
  createWorkspaceConversation,
  listWorkspaceConversations,
  deleteWorkspaceConversation,
} from '@/core/storage/workspace/store'
import { validateWithZod } from '@/core/api/error-handler'
import { CreateConversationSchema, SendMessageSchema } from '@/core/api/schemas/conversation.schema'

export function fetchConversations(params: { type: ConversationType; workspaceId?: string }): Conversation[] {
  if (params.type === 'workspace' && params.workspaceId) {
    // 从工作空间存储获取
    return listWorkspaceConversations(params.workspaceId)
  }
  // 从全局存储获取
  return listConversations()
}

export function createNewConversation(input: CreateConversationInput): Conversation {
  if (input.type === 'workspace' && input.workspaceId) {
    // 创建工作空间会话
    const conv = createWorkspaceConversation(input.workspaceId, input.agentName, input.title)
    if (!conv) throw new Error('创建工作空间会话失败')
    return conv
  }
  // 创建全局会话
  return createConversation(input.agentName, input.title)
}

export function getConversationById(id: string): Conversation | null {
  return getConversation(id)
}

export function deleteExistingConversation(id: string, type?: ConversationType, workspaceId?: string): boolean {
  if (type === 'workspace' && workspaceId) {
    return deleteWorkspaceConversation(workspaceId, id)
  }
  return deleteConversation(id)
}

export function addMessage(
  conversationId: string,
  input: unknown
): { conversation: Conversation; message: ConversationMessage } | null {
  const data = validateWithZod(SendMessageSchema, input)
  const result = appendMessage(
    conversationId,
    data.role as 'user' | 'assistant',
    data.content,
    undefined,
    undefined,
    undefined,
    data.agentAppId
  )
  if (!result) return null
  return { conversation: result.conv, message: result.message }
}
