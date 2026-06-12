/* 日志收集器实现 */

import { v4 as uuidv4 } from 'uuid'
import {
  LogEntry,
  LogLevel,
  LogType,
  LogSource,
  LogFilter,
  LogStats,
  LogReportConfig,
  LogCollector,
  LogMetadata,
  ErrorLog,
  ToolCallLog,
  AgentLoopLog,
  SystemLog,
  PerformanceLog
} from './types'

/** 默认日志配置 */
const DEFAULT_CONFIG: LogReportConfig = {
  enabled: true,
  level: LogLevel.DEBUG,
  batchSize: 100,
  reportInterval: 5000, // 5秒
  maxCacheSize: 10000,
}

/** 日志收集器实现 */
export class DefaultLogCollector implements LogCollector {
  private logs: LogEntry[] = []
  private config: LogReportConfig
  private reportTimer: NodeJS.Timeout | null = null
  private isReporting = false
  private listeners: Set<(entry: LogEntry) => void> = new Set()

  constructor(config?: Partial<LogReportConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startAutoReport()
  }

  /** 添加单条日志，返回创建的完整日志条目 */
  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    if (!this.config.enabled) return null as unknown as LogEntry
    if (!this.shouldLog(entry.level)) return null as unknown as LogEntry

    const logEntry: LogEntry = {
      ...entry,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    }

    this.logs.push(logEntry)

    // 如果缓存过大，清理旧日志
    if (this.logs.length > this.config.maxCacheSize) {
      this.cleanupOldLogs()
    }

    // 触发实时日志事件（可用于UI更新）
    this.emitLogEvent(logEntry)
    
    return logEntry
  }

  /** 批量添加日志 */
  addLogs(entries: Omit<LogEntry, 'id' | 'timestamp'>[]): void {
    entries.forEach(entry => this.addLog(entry))
  }

  /** 获取日志 */
  getLogs(filter?: LogFilter): LogEntry[] {
    let filtered = [...this.logs]

    if (filter) {
      // 级别过滤
      if (filter.level && filter.level.length > 0) {
        filtered = filtered.filter(log => filter.level!.includes(log.level))
      }

      // 类型过滤
      if (filter.type && filter.type.length > 0) {
        filtered = filtered.filter(log => filter.type!.includes(log.type))
      }

      // 来源过滤
      if (filter.source && filter.source.length > 0) {
        filtered = filtered.filter(log => filter.source!.includes(log.source))
      }

      // 时间范围过滤
      if (filter.timeRange) {
        const start = new Date(filter.timeRange.start).getTime()
        const end = new Date(filter.timeRange.end).getTime()
        filtered = filtered.filter(log => {
          const logTime = new Date(log.timestamp).getTime()
          return logTime >= start && logTime <= end
        })
      }

      // 搜索关键词
      if (filter.search) {
        const searchLower = filter.search.toLowerCase()
        filtered = filtered.filter(log =>
          log.message.toLowerCase().includes(searchLower) ||
          JSON.stringify(log.details || {}).toLowerCase().includes(searchLower)
        )
      }

      // 标签过滤
      if (filter.tags && filter.tags.length > 0) {
        filtered = filtered.filter(log =>
          log.tags && filter.tags!.some(tag => log.tags!.includes(tag))
        )
      }

      // 会话ID过滤
      if (filter.conversationId) {
        filtered = filtered.filter(log =>
          log.metadata?.conversationId === filter.conversationId
        )
      }

      // 消息ID过滤
      if (filter.messageId) {
        filtered = filtered.filter(log =>
          log.metadata?.messageId === filter.messageId
        )
      }

      // 工具名称过滤
      if (filter.toolName) {
        filtered = filtered.filter(log => {
          if (log.type === LogType.TOOL_CALL) {
            return (log as ToolCallLog).details.toolName === filter.toolName
          }
          return log.metadata?.toolName === filter.toolName
        })
      }

      // 错误过滤
      if (filter.isError !== undefined) {
        if (filter.isError) {
          filtered = filtered.filter(log =>
            log.level === LogLevel.ERROR || log.level === LogLevel.FATAL
          )
        } else {
          filtered = filtered.filter(log =>
            log.level !== LogLevel.ERROR && log.level !== LogLevel.FATAL
          )
        }
      }
    }

    // 按时间倒序排序（最新的在前）
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // 分页
    if (filter?.pagination) {
      const { page, pageSize } = filter.pagination
      const start = (page - 1) * pageSize
      return filtered.slice(start, start + pageSize)
    }

    return filtered
  }

  /** 获取统计信息 */
  getStats(filter?: LogFilter): LogStats {
    const logs = this.getLogs(filter)

    const byLevel = {} as Record<LogLevel, number>
    const byType = {} as Record<LogType, number>
    const bySource = {} as Record<LogSource, number>

    // 初始化计数器
    Object.values(LogLevel).forEach(level => byLevel[level] = 0)
    Object.values(LogType).forEach(type => byType[type] = 0)
    Object.values(LogSource).forEach(source => bySource[source] = 0)

    let totalDuration = 0
    let durationCount = 0
    const recentErrors: ErrorLog[] = []

    logs.forEach(log => {
      byLevel[log.level]++
      byType[log.type]++
      bySource[log.source]++

      // 统计耗时
      if (log.metadata?.durationMs) {
        totalDuration += log.metadata.durationMs
        durationCount++
      }

      // 收集最近错误
      if (log.level === LogLevel.ERROR || log.level === LogLevel.FATAL) {
        recentErrors.push(log as ErrorLog)
      }
    })

    // 只保留最近10条错误
    recentErrors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    const recentErrorsSlice = recentErrors.slice(0, 10)

    return {
      total: logs.length,
      byLevel,
      byType,
      bySource,
      errorRate: logs.length > 0 ? (byLevel[LogLevel.ERROR] + byLevel[LogLevel.FATAL]) / logs.length : 0,
      averageDuration: durationCount > 0 ? totalDuration / durationCount : undefined,
      recentErrors: recentErrorsSlice,
    }
  }

  /** 清空日志 */
  clearLogs(): void {
    this.logs = []
  }

  /** 上报日志 */
  async reportLogs(): Promise<void> {
    if (this.isReporting || this.logs.length === 0) return

    this.isReporting = true
    try {
      // 获取需要上报的日志
      const logsToReport = this.logs.splice(0, this.config.batchSize)

      if (this.config.customReporter) {
        await this.config.customReporter(logsToReport)
      } else if (this.config.endpoint) {
        await this.sendToEndpoint(logsToReport)
      }
    } catch (error) {
      console.error('Failed to report logs:', error)
      // 上报失败，将日志放回队列
      // 注意：这里简化处理，实际应该有重试机制
    } finally {
      this.isReporting = false
    }
  }

  /** 设置配置 */
  setConfig(config: Partial<LogReportConfig>): void {
    this.config = { ...this.config, ...config }
    
    // 重启自动上报
    if (config.reportInterval !== undefined || config.enabled !== undefined) {
      this.stopAutoReport()
      this.startAutoReport()
    }
  }

  /** 获取配置 */
  getConfig(): LogReportConfig {
    return { ...this.config }
  }

  /** 检查是否应该记录该级别的日志 */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL]
    const configLevelIndex = levels.indexOf(this.config.level)
    const logLevelIndex = levels.indexOf(level)
    return logLevelIndex >= configLevelIndex
  }

  /** 清理旧日志 */
  private cleanupOldLogs(): void {
    // 保留最新的 maxCacheSize 条日志
    this.logs = this.logs.slice(-this.config.maxCacheSize)
  }

  /** 开始自动上报 */
  private startAutoReport(): void {
    if (!this.config.enabled || this.config.reportInterval <= 0) return

    this.reportTimer = setInterval(() => {
      this.reportLogs().catch(console.error)
    }, this.config.reportInterval)
  }

  /** 停止自动上报 */
  private stopAutoReport(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer)
      this.reportTimer = null
    }
  }

  /** 发送到端点 */
  private async sendToEndpoint(logs: LogEntry[]): Promise<void> {
    if (!this.config.endpoint) return

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ logs }),
    })

    if (!response.ok) {
      throw new Error(`Failed to send logs: ${response.status} ${response.statusText}`)
    }
  }

  /** 订阅日志事件 */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 触发日志事件 */
  private emitLogEvent(entry: LogEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch (err) {
        console.error('Log event listener error:', err)
      }
    }
  }
}

/** 创建默认日志收集器实例 */
export const defaultLogCollector = new DefaultLogCollector()

/** 便捷的日志记录函数 */
export const log = {
  /** 调试日志 */
  debug(message: string, metadata?: Partial<LogMetadata>, tags?: string[]): void {
    defaultLogCollector.addLog({
      level: LogLevel.DEBUG,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 信息日志 */
  info(message: string, metadata?: Partial<LogMetadata>, tags?: string[]): void {
    defaultLogCollector.addLog({
      level: LogLevel.INFO,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 警告日志 */
  warn(message: string, metadata?: Partial<LogMetadata>, tags?: string[]): void {
    defaultLogCollector.addLog({
      level: LogLevel.WARN,
      type: LogType.SYSTEM,
      source: LogSource.CLIENT,
      message,
      metadata,
      tags,
    })
  },

  /** 错误日志 */
  error(message: string, error?: Error, metadata?: Partial<LogMetadata>, tags?: string[]): void {
    defaultLogCollector.addLog({
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
  },

  /** 致命错误日志 */
  fatal(message: string, error?: Error, metadata?: Partial<LogMetadata>, tags?: string[]): void {
    defaultLogCollector.addLog({
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
  toolCall(toolName: string, toolCallId: string, input: unknown, output: unknown, isError: boolean, errorText?: string, metadata?: Partial<LogMetadata>): void {
    defaultLogCollector.addLog({
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
  },

  /** Agent循环日志 */
  agentLoop(stepIndex: number, messageCount: number, toolCallCount: number, totalOutputTokens: number, metadata?: Partial<LogMetadata>): void {
    defaultLogCollector.addLog({
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
  },

  /** 系统日志 */
  system(component: string, action: string, status: 'success' | 'failure' | 'pending', metadata?: Partial<LogMetadata>): void {
    defaultLogCollector.addLog({
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
  },

  /** 性能日志 */
  performance(metric: string, value: number, unit: string, metadata?: Partial<LogMetadata>): void {
    defaultLogCollector.addLog({
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
  },
}