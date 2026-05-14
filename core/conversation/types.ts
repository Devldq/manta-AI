/* 会话框架类型定义 */

/** 持久化的工具调用记录（一次工具调用的 input/output） */
export interface ToolCallRecord {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  /** 该消息关联的工具调用记录（assistant 消息专用） */
  toolCalls?: ToolCallRecord[]
  /** token 消耗（assistant 消息专用） */
  usage?: { inputTokens?: number; outputTokens?: number }
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
