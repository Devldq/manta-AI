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

/** 单步 token 用量（含缓存明细） — 与 agent-loop 的 StepUsage 保持同步 */
export interface StepUsageRecord {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  noCacheTokens?: number
  /** 该步骤调用的工具名列表（便于 UI 展示） */
  toolNames?: string[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  /** 该消息关联的工具调用记录（assistant 消息专用） */
  toolCalls?: ToolCallRecord[]
  /** token 消耗（assistant 消息专用） */
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number }
  /** 每步 token 用量明细（assistant 消息专用，用于分步展示） */
  stepUsages?: StepUsageRecord[]
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
