/* 任务存储层内部类型定义（与 @/core/types 隔离）*/

/** 持久化的工具调用记录 */
export interface ToolCallRecord {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

/** 单步 token 用量 */
export interface StepUsageRecord {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  noCacheTokens?: number
  toolNames?: string[]
}

/** 任务消息 */
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  toolCalls?: ToolCallRecord[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
  }
  stepUsages?: StepUsageRecord[]
  agentAppId?: string
}

/** 任务上下文 */
export interface TaskContext {
  [key: string]: unknown
}

/** 任务（存储层内部格式）*/
export interface Task {
  id: string
  title: string
  agentName: string
  messages: Message[]
  context: TaskContext
  workspaceId?: string
  createdAt: string
  updatedAt: string
}
