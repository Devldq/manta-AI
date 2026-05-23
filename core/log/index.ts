/* 统一日志系统主入口 */

export * from './types'
export * from './collector'
export * from './formatter'

import { DefaultLogCollector, defaultLogCollector } from './collector'
import { DefaultLogFormatter, defaultLogFormatter, LogExporter } from './formatter'
import {
  LogEntry,
  LogLevel,
  LogType,
  LogSource,
  LogFilter,
  LogStats,
  LogReportConfig,
  LogCollector,
  LogFormatter,
  LogExportFormat,
  LogExportOptions,
  LogExportResult,
  ToolCallLog,
  AgentLoopLog,
  SystemLog,
  ErrorLog,
  PerformanceLog
} from './types'

/** 日志系统管理器 */
export class LogManager {
  private static instance: LogManager | null = null
  private collector: LogCollector
  private formatter: LogFormatter
  private isInitialized = false

  private constructor(collector?: LogCollector, formatter?: LogFormatter) {
    this.collector = collector || defaultLogCollector
    this.formatter = formatter || defaultLogFormatter
  }

  /** 获取单例实例 */
  static getInstance(collector?: LogCollector, formatter?: LogFormatter): LogManager {
    if (!LogManager.instance) {
      LogManager.instance = new LogManager(collector, formatter)
    }
    return LogManager.instance
  }

  /** 初始化日志系统 */
  initialize(config?: Partial<LogReportConfig>): void {
    if (this.isInitialized) {
      console.warn('LogManager already initialized')
      return
    }

    if (config) {
      this.collector.setConfig(config)
    }

    this.isInitialized = true
    console.log('LogManager initialized with config:', this.collector.getConfig())
  }

  /** 获取收集器 */
  getCollector(): LogCollector {
    return this.collector
  }

  /** 订阅新日志事件，返回取消订阅函数 */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    return this.collector.subscribe(listener)
  }

  /** 获取格式化器 */
  getFormatter(): LogFormatter {
    return this.formatter
  }

  /** 添加日志 */
  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    this.collector.addLog(entry)
  }

  /** 批量添加日志 */
  addLogs(entries: Omit<LogEntry, 'id' | 'timestamp'>[]): void {
    this.collector.addLogs(entries)
  }

  /** 获取日志 */
  getLogs(filter?: LogFilter): LogEntry[] {
    return this.collector.getLogs(filter)
  }

  /** 获取统计信息 */
  getStats(filter?: LogFilter): LogStats {
    return this.collector.getStats(filter)
  }

  /** 清空日志 */
  clearLogs(): void {
    this.collector.clearLogs()
  }

  /** 上报日志 */
  async reportLogs(): Promise<void> {
    await this.collector.reportLogs()
  }

  /** 设置配置 */
  setConfig(config: Partial<LogReportConfig>): void {
    this.collector.setConfig(config)
  }

  /** 获取配置 */
  getConfig(): LogReportConfig {
    return this.collector.getConfig()
  }

  /** 格式化日志 */
  formatLog(entry: LogEntry): string {
    return this.formatter.format(entry)
  }

  /** 格式化日志列表 */
  formatLogs(entries: LogEntry[]): string {
    return this.formatter.formatList(entries)
  }

  /** 格式化统计信息 */
  formatStats(stats: LogStats): string {
    return this.formatter.formatStats(stats)
  }

  /** 导出日志 */
  async exportLogs(options: LogExportOptions): Promise<LogExportResult> {
    const logs = this.getLogs(options.filter)
    let data: string | Blob
    let filename: string

    switch (options.format) {
      case 'json':
        data = LogExporter.toJSON(logs, true)
        filename = `manta-logs-${new Date().toISOString().slice(0, 10)}.json`
        break
      case 'csv':
        data = LogExporter.toCSV(logs)
        filename = `manta-logs-${new Date().toISOString().slice(0, 10)}.csv`
        break
      case 'html':
        data = LogExporter.toHTML(logs)
        filename = `manta-logs-${new Date().toISOString().slice(0, 10)}.html`
        break
      case 'text':
      default:
        data = LogExporter.toText(logs)
        filename = `manta-logs-${new Date().toISOString().slice(0, 10)}.txt`
        break
    }

    return {
      data,
      filename,
      format: options.format,
      size: typeof data === 'string' ? data.length : data.size,
      count: logs.length,
    }
  }

  /** 记录工具调用日志 */
  logToolCall(
    toolName: string,
    toolCallId: string,
    input: unknown,
    output: unknown,
    isError: boolean,
    errorText?: string,
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: isError ? LogLevel.ERROR : LogLevel.INFO,
      type: LogType.TOOL_CALL,
      source: LogSource.TOOL,
      message: `Tool ${toolName} ${isError ? 'failed' : 'completed'}`,
      details: {
        toolCallId,
        toolName,
        input,
        output,
        isError,
        errorText,
        phase: isError ? 'error' : 'complete',
      },
      metadata: {
        ...metadata,
        toolCallId,
        toolName,
      },
      tags: ['tool', toolName],
    })
  }

  /** 记录Agent循环日志 */
  logAgentLoop(
    stepIndex: number,
    messageCount: number,
    toolCallCount: number,
    totalOutputTokens: number,
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: LogLevel.INFO,
      type: LogType.AGENT_LOOP,
      source: LogSource.AGENT,
      message: `Agent loop step ${stepIndex + 1} completed`,
      details: {
        stepIndex,
        messageCount,
        toolCallCount,
        totalOutputTokens,
      },
      metadata: {
        ...metadata,
        stepIndex,
      },
      tags: ['agent', 'loop'],
    })
  }

  /** 记录系统日志 */
  logSystem(
    component: string,
    action: string,
    status: 'success' | 'failure' | 'pending',
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: status === 'failure' ? LogLevel.ERROR : LogLevel.INFO,
      type: LogType.SYSTEM,
      source: LogSource.SYSTEM,
      message: `${component}: ${action} - ${status}`,
      details: {
        component,
        action,
        status,
      },
      metadata,
      tags: ['system', component],
    })
  }

  /** 记录错误日志 */
  logError(
    message: string,
    error?: Error,
    metadata?: Partial<LogEntry['metadata']>,
    tags?: string[]
  ): void {
    this.addLog({
      level: LogLevel.ERROR,
      type: LogType.ERROR,
      source: LogSource.CLIENT,
      message,
      metadata: {
        ...metadata,
        error: error ? {
          type: error.name,
          message: error.message,
          stack: error.stack,
        } : undefined,
      },
      tags,
    })
  }

  /** 记录性能日志 */
  logPerformance(
    metric: string,
    value: number,
    unit: string,
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: LogLevel.INFO,
      type: LogType.PERFORMANCE,
      source: LogSource.SYSTEM,
      message: `Performance: ${metric} = ${value}${unit}`,
      details: {
        metric,
        value,
        unit,
      },
      metadata,
      tags: ['performance', metric],
    })
  }

  /** 记录用户操作日志 */
  logUserAction(
    action: string,
    details?: Record<string, unknown>,
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: LogLevel.INFO,
      type: LogType.USER_ACTION,
      source: LogSource.CLIENT,
      message: `User action: ${action}`,
      details,
      metadata,
      tags: ['user', 'action'],
    })
  }

  /** 记录工作流日志 */
  logWorkflow(
    workflowId: string,
    stepId: string,
    action: string,
    status: 'success' | 'failure' | 'pending',
    metadata?: Partial<LogEntry['metadata']>
  ): void {
    this.addLog({
      level: status === 'failure' ? LogLevel.ERROR : LogLevel.INFO,
      type: LogType.WORKFLOW,
      source: LogSource.SYSTEM,
      message: `Workflow ${workflowId} step ${stepId}: ${action} - ${status}`,
      details: {
        workflowId,
        stepId,
        action,
        status,
      },
      metadata,
      tags: ['workflow', workflowId, stepId],
    })
  }
}

/** 全局日志管理器实例 */
export const logManager = LogManager.getInstance()

/** 便捷的日志记录函数 */
export const logger = {
  /** 初始化日志系统 */
  initialize(config?: Partial<LogReportConfig>): void {
    logManager.initialize(config)
  },

  /** 调试日志 */
  debug(message: string, metadata?: Partial<LogEntry['metadata']>, tags?: string[]): void {
    logManager.addLog({
      level: LogLevel.DEBUG,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 信息日志 */
  info(message: string, metadata?: Partial<LogEntry['metadata']>, tags?: string[]): void {
    logManager.addLog({
      level: LogLevel.INFO,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 警告日志 */
  warn(message: string, metadata?: Partial<LogEntry['metadata']>, tags?: string[]): void {
    logManager.addLog({
      level: LogLevel.WARN,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 错误日志 */
  error(message: string, error?: Error, metadata?: Partial<LogEntry['metadata']>, tags?: string[]): void {
    logManager.logError(message, error, metadata, tags)
  },

  /** 致命错误日志 */
  fatal(message: string, error?: Error, metadata?: Partial<LogEntry['metadata']>, tags?: string[]): void {
    logManager.addLog({
      level: LogLevel.FATAL,
      type: LogType.ERROR,
      source: LogSource.CLIENT,
      message,
      metadata: {
        ...metadata,
        error: error ? {
          type: error.name,
          message: error.message,
          stack: error.stack,
        } : undefined,
      },
      tags,
    })
  },

  /** 工具调用日志 */
  toolCall(toolName: string, toolCallId: string, input: unknown, output: unknown, isError: boolean, errorText?: string, metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logToolCall(toolName, toolCallId, input, output, isError, errorText, metadata)
  },

  /** Agent循环日志 */
  agentLoop(stepIndex: number, messageCount: number, toolCallCount: number, totalOutputTokens: number, metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logAgentLoop(stepIndex, messageCount, toolCallCount, totalOutputTokens, metadata)
  },

  /** 系统日志 */
  system(component: string, action: string, status: 'success' | 'failure' | 'pending', metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logSystem(component, action, status, metadata)
  },

  /** 性能日志 */
  performance(metric: string, value: number, unit: string, metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logPerformance(metric, value, unit, metadata)
  },

  /** 用户操作日志 */
  userAction(action: string, details?: Record<string, unknown>, metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logUserAction(action, details, metadata)
  },

  /** 工作流日志 */
  workflow(workflowId: string, stepId: string, action: string, status: 'success' | 'failure' | 'pending', metadata?: Partial<LogEntry['metadata']>): void {
    logManager.logWorkflow(workflowId, stepId, action, status, metadata)
  },

  /** 获取日志 */
  getLogs(filter?: LogFilter): LogEntry[] {
    return logManager.getLogs(filter)
  },

  /** 获取统计信息 */
  getStats(filter?: LogFilter): LogStats {
    return logManager.getStats(filter)
  },

  /** 清空日志 */
  clearLogs(): void {
    logManager.clearLogs()
  },

  /** 上报日志 */
  async reportLogs(): Promise<void> {
    await logManager.reportLogs()
  },

  /** 设置配置 */
  setConfig(config: Partial<LogReportConfig>): void {
    logManager.setConfig(config)
  },

  /** 获取配置 */
  getConfig(): LogReportConfig {
    return logManager.getConfig()
  },

  /** 格式化日志 */
  formatLog(entry: LogEntry): string {
    return logManager.formatLog(entry)
  },

  /** 格式化日志列表 */
  formatLogs(entries: LogEntry[]): string {
    return logManager.formatLogs(entries)
  },

  /** 格式化统计信息 */
  formatStats(stats: LogStats): string {
    return logManager.formatStats(stats)
  },

  /** 导出日志 */
  async exportLogs(options: LogExportOptions): Promise<LogExportResult> {
    return logManager.exportLogs(options)
  },
}

/** 日志系统钩子（用于React组件） */
export const useLogSystem = () => {
  return {
    logger,
    logManager,
    getLogs: logger.getLogs,
    getStats: logger.getStats,
    clearLogs: logger.clearLogs,
    exportLogs: logger.exportLogs,
  }
}