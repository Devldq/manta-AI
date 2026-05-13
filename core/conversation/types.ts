/* 会话框架类型定义 */

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface ConversationContext {
  [key: string]: unknown
}

export interface Conversation {
  id: string
  title: string
  agentName: string
  messages: Message[]
  context: ConversationContext
  createdAt: string
  updatedAt: string
}
