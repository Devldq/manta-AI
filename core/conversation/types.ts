/* 会话框架类型定义 */

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  taskId?: string  // 关联的 Task ID
}

export interface ConversationContext {
  [key: string]: unknown
}

export interface Conversation {
  id: string
  title: string
  agentName: string  // 当前使用的 Agent
  messages: Message[]
  context: ConversationContext
  createdAt: string
  updatedAt: string
}
