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
