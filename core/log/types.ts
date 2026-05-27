/* 统一日志系统类型定义 */

/** 日志级别 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

/** 日志类型 */
export enum LogType {
  TOOL_CALL = 'tool_call',           // 工具调用日志
  MODEL_OUTPUT = 'model_output',     // 模型输出日志
  SYSTEM = 'system',                 // 系统日志
  AGENT_LOOP = 'agent_loop',         // Agent循环日志
  WORKFLOW = 'workflow',             // 工作流日志
  USER_ACTION = 'user_action',       // 用户操作日志
  PERFORMANCE = 'performance',       // 性能日志
  ERROR = 'error',                   // 错误日志
  SECURITY = 'security',             // 安全日志
}

/** 日志来源 */
export enum LogSource {
  CLIENT = 'client',                 // 前端客户端
  SERVER = 'server',                 // 后端服务
  AGENT = 'agent',                   // Agent系统
  TOOL = 'tool',                     // 工具系统
  SYSTEM = 'system',                 // 系统组件
}

/** 基础日志条目 */
export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  type: LogType
  source: LogSource
  message: string
  details?: Record<string, unknown>
  metadata?: LogMetadata
  tags?: string[]
}

/** 日志元数据 */
export interface LogMetadata {
  /** 会话ID */
  conversationId?: string
  /** 消息ID */
  messageId?: string
  /** 步骤索引 */
  stepIndex?: number
  /** 工具调用ID */
  toolCallId?: string
  /** 工具名称 */
  toolName?: string
  /** 用户ID */
  userId?: string
  /** 任务ID */
  taskId?: string
  /** 步骤ID */
  stepId?: string
  /** 请求ID */
  requestId?: string
  /** 耗时（毫秒） */
  durationMs?: number
  /** 用户输入的提示词（单次对话的 user prompt） */
  prompt?: string
  /** Agent 名称 */
  agentName?: string
  /** 模型名称 */
  model?: string
  /** 模型提供商 */
  provider?: string
  /** Token使用量 */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
  }
  /** 性能指标 */
  performance?: {
    startTime?: number
    endTime?: number
    memoryUsage?: number
    cpuUsage?: number
  }
  /** 错误信息 */
  error?: {
    type?: string
    message?: string
    stack?: string
    code?: string
  }
  /** 消息数量 */
  messageCount?: number
  /** 步骤数量 */
  stepsCount?: number
  /** 工具调用数量 */
  toolCallsCount?: number
  /** 响应内容长度 */
  responseLength?: number
  /** 错误文本 */
  errorText?: string
  /** 是否有 Agent Soul */
  hasSoul?: boolean
  /** Agent Soul 长度 */
  soulLength?: number
  /** Agent Soul 内容 */
  soulContent?: string
  /** System Prompt 长度 */
  systemLength?: number
  /** System Prompt 内容 */
  systemContent?: string
  /** 附加数据 */
  extra?: Record<string, unknown>
}

/** 工具调用日志（兼容现有结构） */
export interface ToolCallLog extends LogEntry {
  type: LogType.TOOL_CALL
  details: {
    toolCallId: string
    toolName: string
    input: unknown
    output: unknown
    isError: boolean
    errorText?: string
    /** 工具调用阶段 */
    phase?: 'start' | 'input' | 'output' | 'error' | 'complete'
    /** 耗时 */
    durationMs?: number
  }
}

/** 模型输出日志 */
export interface ModelOutputLog extends LogEntry {
  type: LogType.MODEL_OUTPUT
  details: {
    /** 步骤索引 */
    stepIndex: number
    /** 模型输出的文本内容 */
    text: string
    /** 文本长度 */
    textLength: number
    /** 该步骤的 token 用量 */
    usage?: {
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
    }
  }
}

/** Agent循环日志 */
export interface AgentLoopLog extends LogEntry {
  type: LogType.AGENT_LOOP
  details: {
    stepIndex: number
    messageCount: number
    toolCallCount: number
    totalOutputTokens: number
    finishReason?: string
    decision?: {
      shouldStop: boolean
      reason?: string
    }
    /** 该步骤的 token 用量（含缓存明细） */
    stepUsage?: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
    }
    /** 循环检测结果 */
    loopDetection?: {
      severity: 'none' | 'low' | 'medium' | 'high'
      type?: string
      message?: string
    }
    /** 性能指标 */
    performance?: {
      stepDurationMs?: number
      toolDurationMs?: number
      totalDurationMs?: number
    }
  }
}

/** 系统日志 */
export interface SystemLog extends LogEntry {
  type: LogType.SYSTEM
  details: {
    component: string
    action: string
    status?: 'success' | 'failure' | 'pending'
    /** 系统状态 */
    state?: Record<string, unknown>
  }
}

/** 错误日志 */
export interface ErrorLog extends LogEntry {
  type: LogType.ERROR
  details: {
    errorType: string
    errorMessage: string
    stack?: string
    code?: string
    /** 错误上下文 */
    context?: Record<string, unknown>
    /** 是否已恢复 */
    recovered?: boolean
  }
}

/** 性能日志 */
export interface PerformanceLog extends LogEntry {
  type: LogType.PERFORMANCE
  details: {
    metric: string
    value: number
    unit: string
    /** 基准值 */
    baseline?: number
    /** 阈值 */
    threshold?: number
    /** 是否超过阈值 */
    exceeded?: boolean
  }
}

/** 日志查询过滤器 */
export interface LogFilter {
  /** 日志级别 */
  level?: LogLevel[]
  /** 日志类型 */
  type?: LogType[]
  /** 日志来源 */
  source?: LogSource[]
  /** 时间范围 */
  timeRange?: {
    start: string
    end: string
  }
  /** 搜索关键词 */
  search?: string
  /** 标签过滤 */
  tags?: string[]
  /** 会话ID */
  conversationId?: string
  /** 消息ID */
  messageId?: string
  /** 工具名称 */
  toolName?: string
  /** 是否错误 */
  isError?: boolean
  /** 分页 */
  pagination?: {
    page: number
    pageSize: number
  }
}

/** 日志统计 */
export interface LogStats {
  total: number
  byLevel: Record<LogLevel, number>
  byType: Record<LogType, number>
  bySource: Record<LogSource, number>
  errorRate: number
  averageDuration?: number
  recentErrors: ErrorLog[]
}

/** 日志上报配置 */
export interface LogReportConfig {
  /** 是否启用 */
  enabled: boolean
  /** 上报级别 */
  level: LogLevel
  /** 批量上报大小 */
  batchSize: number
  /** 上报间隔（毫秒） */
  reportInterval: number
  /** 最大缓存日志数 */
  maxCacheSize: number
  /** 上报端点 */
  endpoint?: string
  /** 自定义上报函数 */
  customReporter?: (logs: LogEntry[]) => Promise<void>
}

/** 日志收集器接口 */
export interface LogCollector {
  /** 添加日志，返回创建的完整日志条目 */
  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry
  /** 批量添加日志 */
  addLogs(entries: Omit<LogEntry, 'id' | 'timestamp'>[]): void
  /** 获取日志 */
  getLogs(filter?: LogFilter): LogEntry[]
  /** 获取统计信息 */
  getStats(filter?: LogFilter): LogStats
  /** 清空日志 */
  clearLogs(): void
  /** 上报日志 */
  reportLogs(): Promise<void>
  /** 设置配置 */
  setConfig(config: Partial<LogReportConfig>): void
  /** 获取配置 */
  getConfig(): LogReportConfig
  /** 订阅新日志事件，返回取消订阅函数 */
  subscribe(listener: (entry: LogEntry) => void): () => void
}

/** 日志格式化器接口 */
export interface LogFormatter {
  /** 格式化单条日志 */
  format(entry: LogEntry): string
  /** 格式化日志列表 */
  formatList(entries: LogEntry[]): string
  /** 格式化统计信息 */
  formatStats(stats: LogStats): string
}

/** 日志导出格式 */
export type LogExportFormat = 'json' | 'csv' | 'text' | 'html'

/** 日志导出选项 */
export interface LogExportOptions {
  format: LogExportFormat
  filter?: LogFilter
  includeMetadata?: boolean
  includeDetails?: boolean
  compression?: 'none' | 'gzip'
}

/** 日志导出结果 */
export interface LogExportResult {
  data: string | Blob
  filename: string
  format: LogExportFormat
  size: number
  count: number
}