import type { Conversation, ConversationMessage } from '@/core/types'
import {
  createConversation,
  listConversations,
  getConversation,
  deleteConversation,
  appendMessage,
} from '@/core/storage/conversation/store'
import { validateWithZod } from '@/core/api/error-handler'
import { CreateConversationSchema, SendMessageSchema } from '@/core/api/schemas/conversation.schema'

export function fetchConversations(params?: { workspaceId?: string }): Conversation[] {
  let conversations = listConversations()

  // 按工作空间过滤（若指定）
  if (params?.workspaceId) {
    conversations = conversations.filter((c) => c.workspaceId === params.workspaceId)
  }

  return conversations
}

export function createNewConversation(input: unknown): Conversation {
  const data = validateWithZod(CreateConversationSchema, input)
  return createConversation(data.agentName, data.title)
}

export function getConversationById(id: string): Conversation | null {
  return getConversation(id)
}

export function deleteExistingConversation(id: string): boolean {
  return deleteConversation(id)
}

export function addMessage(
  conversationId: string,
  input: unknown
): { conversation: Conversation; message: ConversationMessage } | null {
  const data = validateWithZod(SendMessageSchema, input)
  const result = appendMessage(conversationId, data.role as 'user' | 'assistant', data.content)
  if (!result) return null
  return { conversation: result.conv, message: result.message }
}