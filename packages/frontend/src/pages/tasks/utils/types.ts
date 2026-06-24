import type { UIMessage } from 'ai'

export interface StoredToolCall {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: StoredToolCall[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
  }
  stepUsages?: Array<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
    toolNames?: string[]
  }>
}

export interface Conversation {
  id: string
  title: string
  agentName: string
  messages: StoredMessage[]
  context?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  mode?: 'chat' | 'task'
}

export interface AgentEntry {
  name: string
  description?: string
  enabled: boolean
}

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  state: string
  input: unknown
  output: unknown
  errorText?: string
}

export interface StepUsageData {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  noCacheTokens?: number
  toolNames?: string[]
}

/** 按 step 分组的工具调用 */
export interface StepGroup {
  /** 步骤序号（从 0 开始） */
  stepIndex: number
  /** Agent 在该步骤中说的文本（可作为步骤目的/意图） */
  purposeText: string
  /** 该步骤的工具调用列表 */
  toolCalls: ToolCallEntry[]
  /** 步骤是否已完成（已收到 finish-step） */
  isComplete: boolean
  /** 步骤是否正在执行中 */
  isActive: boolean
}
