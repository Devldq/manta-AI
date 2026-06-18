import type { Conversation, ConversationMessage, ConversationType, CreateConversationInput } from '../types'
import {
  createConversation,
  listConversations,
  getConversation,
  deleteConversation,
  appendMessage,
} from '../storage/conversation/store'
import {
  createWorkspaceConversation,
  listWorkspaceConversations,
  deleteWorkspaceConversation,
} from '../storage/workspace/store'

export const conversationService = {
  fetchConversations(params: { type: ConversationType; workspaceId?: string }): Conversation[] {
    if (params.type === 'workspace' && params.workspaceId) {
      return listWorkspaceConversations(params.workspaceId)
    }
    return listConversations()
  },

  createNewConversation(input: CreateConversationInput): Conversation {
    if (input.type === 'workspace' && input.workspaceId) {
      const conv = createWorkspaceConversation(input.workspaceId, input.agentName, input.title)
      if (!conv) throw new Error('创建工作空间会话失败')
      return conv
    }
    return createConversation(input.agentName, input.title)
  },

  getConversationById(id: string): Conversation | null {
    return getConversation(id)
  },

  deleteExistingConversation(id: string, type?: ConversationType, workspaceId?: string): boolean {
    if (type === 'workspace' && workspaceId) {
      return deleteWorkspaceConversation(workspaceId, id)
    }
    return deleteConversation(id)
  },

  addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    agentAppId?: string
  ): { conversation: Conversation; message: ConversationMessage } | null {
    const result = appendMessage(conversationId, role, content, undefined, undefined, undefined, agentAppId)
    if (!result) return null
    return { conversation: result.conv, message: result.message }
  },

  getConversationMessages(conversationId: string): ConversationMessage[] {
    const conv = getConversation(conversationId)
    return conv?.messages || []
  }
}
