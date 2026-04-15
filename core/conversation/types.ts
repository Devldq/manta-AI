/* 会话框架类型定义 */

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  taskId?: string  // 关联的 Task ID（task 模式专用）
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
  /** 会话模式：chat = 直接走 LangChain；task = 创建 Task 经 OpenClaw 执行（默认）*/
  mode?: 'chat' | 'task'
}
