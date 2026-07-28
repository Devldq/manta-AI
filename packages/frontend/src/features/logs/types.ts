export type WorkspaceLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface WorkspaceLogEntry {
  id: string
  timestamp: string
  level: WorkspaceLogLevel
  type: string
  source: string
  message: string
  details?: Record<string, unknown>
  metadata?: {
    conversationId?: string
    workspaceId?: string
    messageId?: string
    stepIndex?: number
    durationMs?: number
    toolName?: string
    usage?: Record<string, number | undefined>
    [key: string]: unknown
  }
  tags?: string[]
}

export interface WorkspaceLogFileResponse {
  entries: WorkspaceLogEntry[]
  offset: number
  fileSize?: number
  reset?: boolean
  truncated?: boolean
  invalidLines?: number
  error?: string
}

export type WorkspaceLogLevelFilter = 'all' | WorkspaceLogLevel

export interface WorkspaceLogGroup {
  key: string
  label: string
  stepIndex?: number
  messageId?: string
  latestAt: string
  entries: WorkspaceLogEntry[]
  errorCount: number
}
