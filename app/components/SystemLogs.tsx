/* 系统日志组件 */

'use client'

import React, { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { 
  ScrollText, 
  Clock, 
  ChevronDown, 
  Copy, 
  ClipboardCheck, 
  Filter, 
  Search, 
  RefreshCw, 
  Trash2, 
  Download,
  Upload,
  Settings,
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  Bug,
  Zap,
  Workflow,
  User,
  Shield,
  Wrench,
  Terminal,
  FileCode,
  FileSearch,
  Folder,
  Pencil
} from 'lucide-react'
import { useLogState, useLogFilter, useLogExport, useLogActions } from '@/core/log/hooks'
import { LogEntry, LogLevel, LogType, LogSource, LogFilter } from '@/core/log/types'

/** 日志级别图标映射 */
const LEVEL_ICONS: Record<LogLevel, React.ComponentType<{ size?: number; className?: string }>> = {
  [LogLevel.DEBUG]: Bug,
  [LogLevel.INFO]: Info,
  [LogLevel.WARN]: AlertTriangle,
  [LogLevel.ERROR]: XCircle,
  [LogLevel.FATAL]: AlertCircle,
}

/** 日志级别颜色映射 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'text-gray-500 bg-gray-500/10',
  [LogLevel.INFO]: 'text-blue-500 bg-blue-500/10',
  [LogLevel.WARN]: 'text-yellow-500 bg-yellow-500/10',
  [LogLevel.ERROR]: 'text-red-500 bg-red-500/10',
  [LogLevel.FATAL]: 'text-purple-500 bg-purple-500/10',
}

/** 日志类型图标映射 */
const TYPE_ICONS: Record<LogType, React.ComponentType<{ size?: number; className?: string }>> = {
  [LogType.TOOL_CALL]: Wrench,
  [LogType.SYSTEM]: Settings,
  [LogType.AGENT_LOOP]: RefreshCw,
  [LogType.WORKFLOW]: Workflow,
  [LogType.USER_ACTION]: User,
  [LogType.PERFORMANCE]: Zap,
  [LogType.ERROR]: XCircle,
  [LogType.SECURITY]: Shield,
}

/** 日志来源标签映射 */
const SOURCE_LABELS: Record<LogSource, string> = {
  [LogSource.CLIENT]: '客户端',
  [LogSource.SERVER]: '服务端',
  [LogSource.AGENT]: 'Agent',
  [LogSource.TOOL]: '工具',
  [LogSource.SYSTEM]: '系统',
}

/** 工具图标映射 */
const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  lsDir: Folder,
  readFile: FileCode,
  glob: FileSearch,
  grep: Search,
  bash: Terminal,
  write: Pencil,
  edit: Pencil,
  multiEdit: Pencil,
}

/** 格式化相对时间 */
function formatRelativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}m 前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h 前`
    return `${Math.floor(hours / 24)}d 前`
  } catch {
    return ''
  }
}

/** 格式化日志时间 */
function formatLogTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/** 格式化token数 */
function fmtTokens(n: number | undefined): string {
  if (n === undefined || n === 0) return ''
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return String(n)
}

/** 系统日志组件属性 */
interface SystemLogsProps {
  /** 会话ID（可选，用于过滤特定会话的日志） */
  conversationId?: string
  /** 初始过滤器 */
  initialFilter?: LogFilter
  /** 是否显示过滤器 */
  showFilter?: boolean
  /** 是否显示统计信息 */
  showStats?: boolean
  /** 是否显示操作按钮 */
  showActions?: boolean
  /** 最大高度 */
  maxHeight?: string
}

/** 系统日志组件 */
export const SystemLogs = memo(function SystemLogs({
  conversationId,
  initialFilter,
  showFilter = true,
  showStats = true,
  showActions = true,
  maxHeight = '100%',
}: SystemLogsProps) {
  // 日志状态 - 用 useMemo 稳定 filter 引用，避免无限渲染
  const logFilter = useMemo(
    () => ({ ...initialFilter, conversationId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId]
  )
  const { logs, stats, loading, error, refreshLogs } = useLogState(logFilter)

  // 日志过滤
  const {
    filter,
    updateFilter,
    resetFilter,
    addLevelFilter,
    removeLevelFilter,
    addTypeFilter,
    removeTypeFilter,
    addSourceFilter,
    removeSourceFilter,
    setSearch,
    setTimeRange,
    clearTimeRange,
  } = useLogFilter()

  // 日志导出
  const { exporting, exportResult, exportLogs, downloadExport, clearExport } = useLogExport()

  // 日志操作
  const { clearing, reporting, clearLogs, reportLogs } = useLogActions()

  // 搜索状态
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // 应用初始过滤器
  useEffect(() => {
    if (initialFilter) {
      updateFilter(initialFilter)
    }
  }, [initialFilter, updateFilter])

  // 应用会话ID过滤
  useEffect(() => {
    if (conversationId) {
      updateFilter({ conversationId })
    }
  }, [conversationId, updateFilter])

  // 搜索处理
  const handleSearch = (term: string) => {
    setSearchTerm(term)
    setSearch(term)
  }

  // 刷新日志
  const handleRefresh = () => {
    refreshLogs()
  }

  // 清空日志
  const handleClear = async () => {
    if (confirm('确定要清空所有日志吗？此操作不可恢复。')) {
      await clearLogs()
      refreshLogs()
    }
  }

  // 上报日志
  const handleReport = async () => {
    await reportLogs()
    refreshLogs()
  }

  // 导出日志
  const handleExport = async (format: 'json' | 'csv' | 'text' | 'html') => {
    try {
      const result = await exportLogs({
        format,
        filter,
        includeMetadata: true,
        includeDetails: true,
      })
      downloadExport(result)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  // 复制日志
  const handleCopyLog = async (log: LogEntry) => {
    const text = `[${log.timestamp}] ${log.level.toUpperCase()} ${log.type}: ${log.message}`
    await navigator.clipboard.writeText(text)
  }

  // 复制所有日志
  const handleCopyAll = async () => {
    const text = logs.map(log => 
      `[${log.timestamp}] ${log.level.toUpperCase()} ${log.type}: ${log.message}`
    ).join('\n')
    await navigator.clipboard.writeText(text)
  }

  // 获取日志级别图标
  const getLevelIcon = (level: LogLevel) => {
    const Icon = LEVEL_ICONS[level] || Info
    return <Icon size={12} />
  }

  // 获取日志类型图标
  const getTypeIcon = (type: LogType) => {
    const Icon = TYPE_ICONS[type] || Settings
    return <Icon size={12} />
  }

  // 获取工具图标
  const getToolIcon = (toolName: string) => {
    const Icon = TOOL_ICON_MAP[toolName] || Wrench
    return <Icon size={12} />
  }

  // 渲染日志条目
  const renderLogEntry = (log: LogEntry, index: number) => {
    const levelColor = LEVEL_COLORS[log.level] || 'text-gray-500 bg-gray-500/10'
    const isToolCall = log.type === LogType.TOOL_CALL
    const toolName = isToolCall ? (log.details as any)?.toolName : null

    return (
      <div
        key={log.id}
        className={`px-3 py-2 border-b border-border-subtle hover:bg-surface/50 transition-colors ${
          log.level === LogLevel.ERROR || log.level === LogLevel.FATAL 
            ? 'bg-red-500/5' 
            : ''
        }`}
      >
        <div className="flex items-start gap-2">
          {/* 时间戳 */}
          <span className="text-[10px] text-text-muted/50 flex-shrink-0 select-none w-16">
            {formatLogTime(log.timestamp)}
          </span>

          {/* 日志级别 */}
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${levelColor}`}>
            {getLevelIcon(log.level)}
            {log.level.toUpperCase()}
          </span>

          {/* 日志类型 */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface/50 text-text-secondary">
            {getTypeIcon(log.type)}
            {log.type}
          </span>

          {/* 日志来源 */}
          <span className="text-[10px] text-text-muted">
            [{SOURCE_LABELS[log.source] || log.source}]
          </span>

          {/* 工具名称（如果是工具调用日志） */}
          {isToolCall && toolName && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">
              {getToolIcon(toolName)}
              {toolName}
            </span>
          )}

          {/* 操作按钮 */}
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handleCopyLog(log)}
              title="复制日志"
              className="p-0.5 rounded hover:bg-surface/60 transition-colors text-text-muted/40 hover:text-text-muted"
            >
              <Copy size={10} />
            </button>
          </div>
        </div>

        {/* 日志消息 */}
        <div className="mt-1 ml-16">
          <p className="text-xs text-text-primary font-mono whitespace-pre-wrap break-all">
            {log.message}
          </p>
        </div>

        {/* 日志详情（如果有） */}
        {log.details && (
          <div className="mt-1 ml-16">
            <details className="text-[10px] text-text-muted">
              <summary className="cursor-pointer hover:text-text-secondary">
                详情
              </summary>
              <pre className="mt-1 p-2 bg-surface/30 rounded overflow-x-auto">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* 标签（如果有） */}
        {log.tags && log.tags.length > 0 && (
          <div className="mt-1 ml-16 flex flex-wrap gap-1">
            {log.tags.map((tag, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-surface/50 text-text-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 元数据（如果有） */}
        {log.metadata && Object.keys(log.metadata).length > 0 && (
          <div className="mt-1 ml-16">
            <details className="text-[10px] text-text-muted">
              <summary className="cursor-pointer hover:text-text-secondary">
                元数据
              </summary>
              <pre className="mt-1 p-2 bg-surface/30 rounded overflow-x-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    )
  }

  // 渲染统计信息
  const renderStats = () => {
    if (!stats) return null

    return (
      <div className="px-3 py-2 border-b border-border-subtle bg-background flex items-center gap-4 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-text-muted" />
          <span className="text-xs text-text-muted">
            共 <span className="font-semibold text-text-secondary">{stats.total}</span> 条日志
          </span>
        </div>

        {stats.errorRate > 0 && (
          <div className="flex items-center gap-1">
            <AlertCircle size={12} className="text-red-500" />
            <span className="text-xs text-red-500">
              错误率: {(stats.errorRate * 100).toFixed(1)}%
            </span>
          </div>
        )}

        {stats.averageDuration !== undefined && (
          <div className="flex items-center gap-1">
            <Zap size={12} className="text-yellow-500" />
            <span className="text-xs text-yellow-500">
              平均耗时: {stats.averageDuration.toFixed(0)}ms
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    )
  }

  // 渲染过滤器面板
  const renderFilterPanel = () => {
    if (!showFilterPanel) return null

    return (
      <div className="px-3 py-2 border-b border-border-subtle bg-surface/30">
        <div className="flex items-center gap-2 mb-2">
          <Filter size={12} className="text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">过滤器</span>
          <button
            onClick={resetFilter}
            className="ml-auto text-[10px] text-text-muted hover:text-text-secondary"
          >
            重置
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {/* 级别过滤 */}
          {Object.values(LogLevel).map(level => (
            <button
              key={level}
              onClick={() => {
                if (filter.level?.includes(level)) {
                  removeLevelFilter(level)
                } else {
                  addLevelFilter(level)
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                filter.level?.includes(level)
                  ? LEVEL_COLORS[level]
                  : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}
            >
              {level.toUpperCase()}
            </button>
          ))}

          {/* 类型过滤 */}
          {Object.values(LogType).map(type => (
            <button
              key={type}
              onClick={() => {
                if (filter.type?.includes(type)) {
                  removeTypeFilter(type)
                } else {
                  addTypeFilter(type)
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                filter.type?.includes(type)
                  ? 'bg-accent/10 text-accent'
                  : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}
            >
              {type}
            </button>
          ))}

          {/* 来源过滤 */}
          {Object.values(LogSource).map(source => (
            <button
              key={source}
              onClick={() => {
                if (filter.source?.includes(source)) {
                  removeSourceFilter(source)
                } else {
                  addSourceFilter(source)
                }
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                filter.source?.includes(source)
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}
            >
              {SOURCE_LABELS[source] || source}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // 渲染操作按钮
  const renderActions = () => {
    if (!showActions) return null

    return (
      <div className="px-3 py-2 border-b border-border-subtle bg-background flex items-center gap-2 sticky top-0 z-10">
        {/* 搜索框 */}
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="搜索日志..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface/50 border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          />
        </div>

        {/* 过滤器按钮 */}
        <button
          onClick={() => setShowFilterPanel(!showFilterPanel)}
          className={`p-1.5 rounded transition-colors ${
            showFilterPanel
              ? 'bg-accent/10 text-accent'
              : 'hover:bg-surface/60 text-text-muted hover:text-text-secondary'
          }`}
          title="过滤器"
        >
          <Filter size={12} />
        </button>

        {/* 刷新按钮 */}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1.5 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* 上报按钮 */}
        <button
          onClick={handleReport}
          disabled={reporting}
          className="p-1.5 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
          title="上报日志"
        >
          <Upload size={12} className={reporting ? 'animate-pulse' : ''} />
        </button>

        {/* 导出按钮 */}
        <div className="relative group">
          <button
            disabled={exporting}
            className="p-1.5 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
            title="导出日志"
          >
            <Download size={12} className={exporting ? 'animate-pulse' : ''} />
          </button>
          
          {/* 导出选项下拉菜单 */}
          <div className="absolute right-0 top-full mt-1 w-32 bg-background border border-border-subtle rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
            <div className="py-1">
              <button
                onClick={() => handleExport('json')}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface/50"
              >
                JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface/50"
              >
                CSV
              </button>
              <button
                onClick={() => handleExport('text')}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface/50"
              >
                纯文本
              </button>
              <button
                onClick={() => handleExport('html')}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface/50"
              >
                HTML
              </button>
            </div>
          </div>
        </div>

        {/* 复制按钮 */}
        <button
          onClick={handleCopyAll}
          className="p-1.5 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary"
          title="复制所有日志"
        >
          <Copy size={12} />
        </button>

        {/* 清空按钮 */}
        <button
          onClick={handleClear}
          disabled={clearing}
          className="p-1.5 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
          title="清空日志"
        >
          <Trash2 size={12} className={clearing ? 'animate-pulse' : ''} />
        </button>
      </div>
    )
  }

  // 渲染空状态
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <ScrollText size={32} className="text-text-muted mb-3 opacity-50" />
      <p className="text-sm text-text-muted">暂无系统日志</p>
      <p className="text-xs text-text-muted mt-1">系统运行后，这里将显示详细日志</p>
    </div>
  )

  // 渲染加载状态
  const renderLoadingState = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <RefreshCw size={32} className="text-text-muted mb-3 opacity-50 animate-spin" />
      <p className="text-sm text-text-muted">加载中...</p>
    </div>
  )

  // 渲染错误状态
  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <AlertCircle size={32} className="text-red-500 mb-3 opacity-50" />
      <p className="text-sm text-red-500">加载失败</p>
      <p className="text-xs text-text-muted mt-1">{error?.message}</p>
      <button
        onClick={handleRefresh}
        className="mt-2 px-3 py-1.5 text-xs bg-surface/50 rounded hover:bg-surface/80"
      >
        重试
      </button>
    </div>
  )

  // 主渲染
  return (
    <div className="flex flex-col h-full" style={{ maxHeight }}>
      {/* 统计信息 */}
      {showStats && renderStats()}

      {/* 操作按钮 */}
      {renderActions()}

      {/* 过滤器面板 */}
      {renderFilterPanel()}

      {/* 日志列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          renderLoadingState()
        ) : error ? (
          renderErrorState()
        ) : logs.length === 0 ? (
          renderEmptyState()
        ) : (
          <div className="font-mono text-[11px] leading-relaxed">
            {logs.map((log, index) => renderLogEntry(log, index))}
          </div>
        )}
      </div>
    </div>
  )
})

/** 导出组件 */
export default SystemLogs