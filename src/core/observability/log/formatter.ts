/* 日志格式化器实现 */

import {
  LogEntry,
  LogLevel,
  LogType,
  LogSource,
  LogStats,
  LogFormatter,
  ToolCallLog,
  AgentLoopLog,
  SystemLog,
  ErrorLog,
  PerformanceLog
} from './types'

/** 日志级别颜色映射（用于终端输出） */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m', // 青色
  [LogLevel.INFO]: '\x1b[32m',  // 绿色
  [LogLevel.WARN]: '\x1b[33m',  // 黄色
  [LogLevel.ERROR]: '\x1b[31m', // 红色
  [LogLevel.FATAL]: '\x1b[35m', // 紫色
}

/** 日志类型图标映射 */
const TYPE_ICONS: Record<LogType, string> = {
  [LogType.TOOL_CALL]: '🔧',
  [LogType.SYSTEM]: '⚙️',
  [LogType.AGENT_LOOP]: '🔄',
  [LogType.WORKFLOW]: '📋',
  [LogType.USER_ACTION]: '👤',
  [LogType.PERFORMANCE]: '⚡',
  [LogType.ERROR]: '❌',
  [LogType.SECURITY]: '🔒',
}

/** 日志来源标签映射 */
const SOURCE_LABELS: Record<LogSource, string> = {
  [LogSource.CLIENT]: 'CLIENT',
  [LogSource.SERVER]: 'SERVER',
  [LogSource.AGENT]: 'AGENT',
  [LogSource.TOOL]: 'TOOL',
  [LogSource.SYSTEM]: 'SYSTEM',
}

/** 默认日志格式化器 */
export class DefaultLogFormatter implements LogFormatter {
  /** 格式化单条日志 */
  format(entry: LogEntry): string {
    const timestamp = this.formatTimestamp(entry.timestamp)
    const level = this.formatLevel(entry.level)
    const type = this.formatType(entry.type)
    const source = this.formatSource(entry.source)
    const message = entry.message

    let formatted = `[${timestamp}] ${level} ${type} ${source}: ${message}`

    // 添加元数据
    if (entry.metadata) {
      const metaParts: string[] = []
      
      if (entry.metadata.conversationId) {
        metaParts.push(`conv=${entry.metadata.conversationId}`)
      }
      if (entry.metadata.messageId) {
        metaParts.push(`msg=${entry.metadata.messageId}`)
      }
      if (entry.metadata.stepIndex !== undefined) {
        metaParts.push(`step=${entry.metadata.stepIndex}`)
      }
      if (entry.metadata.toolCallId) {
        metaParts.push(`tc=${entry.metadata.toolCallId}`)
      }
      if (entry.metadata.toolName) {
        metaParts.push(`tool=${entry.metadata.toolName}`)
      }
      if (entry.metadata.durationMs !== undefined) {
        metaParts.push(`duration=${entry.metadata.durationMs}ms`)
      }

      if (metaParts.length > 0) {
        formatted += ` [${metaParts.join(', ')}]`
      }
    }

    // 添加标签
    if (entry.tags && entry.tags.length > 0) {
      formatted += ` #${entry.tags.join(' #')}`
    }

    return formatted
  }

  /** 格式化日志列表 */
  formatList(entries: LogEntry[]): string {
    if (entries.length === 0) {
      return 'No logs to display'
    }

    return entries.map(entry => this.format(entry)).join('\n')
  }

  /** 格式化统计信息 */
  formatStats(stats: LogStats): string {
    const lines: string[] = []
    
    lines.push('=== Log Statistics ===')
    lines.push(`Total logs: ${stats.total}`)
    lines.push(`Error rate: ${(stats.errorRate * 100).toFixed(2)}%`)
    
    if (stats.averageDuration !== undefined) {
      lines.push(`Average duration: ${stats.averageDuration.toFixed(2)}ms`)
    }

    lines.push('')
    lines.push('By Level:')
    Object.entries(stats.byLevel).forEach(([level, count]) => {
      if (count > 0) {
        lines.push(`  ${level}: ${count}`)
      }
    })

    lines.push('')
    lines.push('By Type:')
    Object.entries(stats.byType).forEach(([type, count]) => {
      if (count > 0) {
        lines.push(`  ${type}: ${count}`)
      }
    })

    lines.push('')
    lines.push('By Source:')
    Object.entries(stats.bySource).forEach(([source, count]) => {
      if (count > 0) {
        lines.push(`  ${source}: ${count}`)
      }
    })

    if (stats.recentErrors.length > 0) {
      lines.push('')
      lines.push('Recent Errors:')
      stats.recentErrors.forEach((error, index) => {
        lines.push(`  ${index + 1}. [${error.timestamp}] ${error.message}`)
        if (error.details?.errorMessage) {
          lines.push(`     Error: ${error.details.errorMessage}`)
        }
      })
    }

    return lines.join('\n')
  }

  /** 格式化时间戳 */
  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('zh-CN', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3
      })
    } catch {
      return timestamp
    }
  }

  /** 格式化日志级别 */
  private formatLevel(level: LogLevel): string {
    const color = LEVEL_COLORS[level] || ''
    const reset = '\x1b[0m'
    return `${color}${level.toUpperCase().padEnd(5)}${reset}`
  }

  /** 格式化日志类型 */
  private formatType(type: LogType): string {
    const icon = TYPE_ICONS[type] || '📝'
    return `${icon} ${type}`
  }

  /** 格式化日志来源 */
  private formatSource(source: LogSource): string {
    const label = SOURCE_LABELS[source] || source
    return `[${label}]`
  }

  /** 格式化工具调用日志 */
  formatToolCall(log: ToolCallLog): string {
    const timestamp = this.formatTimestamp(log.timestamp)
    const level = this.formatLevel(log.level)
    const details = log.details

    let formatted = `[${timestamp}] ${level} 🔧 TOOL_CALL: ${details.toolName}`

    if (details.phase) {
      formatted += ` (${details.phase})`
    }

    if (details.isError) {
      formatted += ` ❌ ERROR: ${details.errorText || 'Unknown error'}`
    } else if (details.phase === 'complete') {
      formatted += ` ✅ COMPLETED`
    }

    if (details.durationMs !== undefined) {
      formatted += ` ⏱️ ${details.durationMs}ms`
    }

    return formatted
  }

  /** 格式化Agent循环日志 */
  formatAgentLoop(log: AgentLoopLog): string {
    const timestamp = this.formatTimestamp(log.timestamp)
    const level = this.formatLevel(log.level)
    const details = log.details

    let formatted = `[${timestamp}] ${level} 🔄 AGENT_LOOP: Step ${details.stepIndex + 1}`

    formatted += ` | Messages: ${details.messageCount}`
    formatted += ` | Tools: ${details.toolCallCount}`
    formatted += ` | Tokens: ${details.totalOutputTokens}`

    if (details.finishReason) {
      formatted += ` | Finish: ${details.finishReason}`
    }

    if (details.decision?.shouldStop) {
      formatted += ` | STOP: ${details.decision.reason || 'completed'}`
    }

    if (details.loopDetection?.severity !== 'none') {
      formatted += ` | LOOP: ${details.loopDetection.severity}`
    }

    if (details.performance?.stepDurationMs) {
      formatted += ` | ⏱️ ${details.performance.stepDurationMs}ms`
    }

    return formatted
  }

  /** 格式化系统日志 */
  formatSystem(log: SystemLog): string {
    const timestamp = this.formatTimestamp(log.timestamp)
    const level = this.formatLevel(log.level)
    const details = log.details

    let formatted = `[${timestamp}] ${level} ⚙️ SYSTEM: ${details.component} - ${details.action}`

    if (details.status) {
      const statusIcon = details.status === 'success' ? '✅' : 
                         details.status === 'failure' ? '❌' : '⏳'
      formatted += ` ${statusIcon} ${details.status}`
    }

    return formatted
  }

  /** 格式化错误日志 */
  formatError(log: ErrorLog): string {
    const timestamp = this.formatTimestamp(log.timestamp)
    const level = this.formatLevel(log.level)
    const details = log.details

    let formatted = `[${timestamp}] ${level} ❌ ERROR: ${log.message}`

    if (details.errorType) {
      formatted += ` (${details.errorType})`
    }

    if (details.errorMessage) {
      formatted += `\n  Error: ${details.errorMessage}`
    }

    if (details.code) {
      formatted += `\n  Code: ${details.code}`
    }

    if (details.stack && process.env.NODE_ENV === 'development') {
      formatted += `\n  Stack: ${details.stack.split('\n').slice(0, 3).join('\n    ')}`
    }

    return formatted
  }

  /** 格式化性能日志 */
  formatPerformance(log: PerformanceLog): string {
    const timestamp = this.formatTimestamp(log.timestamp)
    const level = this.formatLevel(log.level)
    const details = log.details

    let formatted = `[${timestamp}] ${level} ⚡ PERF: ${details.metric} = ${details.value}${details.unit}`

    if (details.baseline !== undefined) {
      const diff = details.value - details.baseline
      const percent = details.baseline !== 0 ? (diff / details.baseline * 100).toFixed(1) : 'N/A'
      formatted += ` (baseline: ${details.baseline}${details.unit}, diff: ${diff > 0 ? '+' : ''}${diff}${details.unit}, ${percent}%)`
    }

    if (details.threshold !== undefined && details.exceeded) {
      formatted += ` ⚠️ EXCEEDED THRESHOLD: ${details.threshold}${details.unit}`
    }

    return formatted
  }
}

/** 创建默认格式化器实例 */
export const defaultLogFormatter = new DefaultLogFormatter()

/** 便捷的日志格式化函数 */
export const formatLog = {
  /** 格式化单条日志 */
  entry(entry: LogEntry): string {
    return defaultLogFormatter.format(entry)
  },

  /** 格式化日志列表 */
  list(entries: LogEntry[]): string {
    return defaultLogFormatter.formatList(entries)
  },

  /** 格式化统计信息 */
  stats(stats: LogStats): string {
    return defaultLogFormatter.formatStats(stats)
  },

  /** 格式化工具调用日志 */
  toolCall(log: ToolCallLog): string {
    return defaultLogFormatter.formatToolCall(log)
  },

  /** 格式化Agent循环日志 */
  agentLoop(log: AgentLoopLog): string {
    return defaultLogFormatter.formatAgentLoop(log)
  },

  /** 格式化系统日志 */
  system(log: SystemLog): string {
    return defaultLogFormatter.formatSystem(log)
  },

  /** 格式化错误日志 */
  error(log: ErrorLog): string {
    return defaultLogFormatter.formatError(log)
  },

  /** 格式化性能日志 */
  performance(log: PerformanceLog): string {
    return defaultLogFormatter.formatPerformance(log)
  },
}

/** 日志导出格式化器 */
export class LogExporter {
  /** 导出为JSON格式 */
  static toJSON(entries: LogEntry[], pretty: boolean = false): string {
    return JSON.stringify(entries, null, pretty ? 2 : undefined)
  }

  /** 导出为CSV格式 */
  static toCSV(entries: LogEntry[]): string {
    if (entries.length === 0) return ''

    const headers = ['id', 'timestamp', 'level', 'type', 'source', 'message', 'details', 'metadata', 'tags']
    const rows = entries.map(entry => [
      entry.id,
      entry.timestamp,
      entry.level,
      entry.type,
      entry.source,
      `"${entry.message.replace(/"/g, '""')}"`,
      `"${JSON.stringify(entry.details || {}).replace(/"/g, '""')}"`,
      `"${JSON.stringify(entry.metadata || {}).replace(/"/g, '""')}"`,
      `"${(entry.tags || []).join(', ')}"`,
    ])

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
  }

  /** 导出为HTML格式 */
  static toHTML(entries: LogEntry[]): string {
    const levelColors: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: '#6c757d',
      [LogLevel.INFO]: '#28a745',
      [LogLevel.WARN]: '#ffc107',
      [LogLevel.ERROR]: '#dc3545',
      [LogLevel.FATAL]: '#6f42c1',
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Manta System Logs</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background: #f5f5f5; }
    .log-container { background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
    .log-header { background: #343a40; color: white; padding: 15px 20px; font-size: 18px; font-weight: bold; }
    .log-entry { padding: 12px 20px; border-bottom: 1px solid #eee; font-size: 14px; }
    .log-entry:hover { background: #f8f9fa; }
    .log-timestamp { color: #6c757d; font-size: 12px; margin-right: 10px; }
    .log-level { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-right: 10px; }
    .log-type { color: #495057; margin-right: 10px; }
    .log-source { color: #6c757d; margin-right: 10px; }
    .log-message { color: #212529; }
    .log-details { color: #6c757d; font-size: 12px; margin-top: 5px; }
    .log-tags { margin-top: 5px; }
    .log-tag { display: inline-block; background: #e9ecef; color: #495057; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-right: 5px; }
  </style>
</head>
<body>
  <div class="log-container">
    <div class="log-header">Manta System Logs (${entries.length} entries)</div>
    ${entries.map(entry => `
    <div class="log-entry">
      <span class="log-timestamp">${entry.timestamp}</span>
      <span class="log-level" style="background: ${levelColors[entry.level] || '#6c757d'}; color: white;">${entry.level.toUpperCase()}</span>
      <span class="log-type">${entry.type}</span>
      <span class="log-source">[${entry.source}]</span>
      <span class="log-message">${entry.message}</span>
      ${entry.tags && entry.tags.length > 0 ? `
      <div class="log-tags">
        ${entry.tags.map(tag => `<span class="log-tag">#${tag}</span>`).join('')}
      </div>
      ` : ''}
    </div>
    `).join('')}
  </div>
</body>
</html>`

    return html
  }

  /** 导出为纯文本格式 */
  static toText(entries: LogEntry[]): string {
    return defaultLogFormatter.formatList(entries)
  }
}