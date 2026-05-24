/* 会话日志组件 — 紧凑单行视图，按 agent-loop 轮次分组 */

'use client'

import React, { useState, useEffect, useMemo, memo } from 'react'
import { 
  ScrollText, 
  ChevronDown, 
  ChevronRight,
  Copy, 
  Filter, 
  Search, 
  RefreshCw, 
  Trash2, 
  Download,
  Upload,
  AlertCircle,
  Wrench,
  Terminal,
  FileCode,
  FileSearch,
  Folder,
  Pencil,
  Layers,
  List,
} from 'lucide-react'
import { useLogState, useLogFilter, useLogExport, useLogActions } from '@/core/log/hooks'
import { LogEntry, LogLevel, LogType, LogSource, LogFilter } from '@/core/log/types'

/** 日志级别颜色映射（纯前景色） */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'text-gray-500',
  [LogLevel.INFO]: 'text-blue-500',
  [LogLevel.WARN]: 'text-yellow-500',
  [LogLevel.ERROR]: 'text-red-500',
  [LogLevel.FATAL]: 'text-purple-500',
}

/** 日志级别背景色映射 */
const LEVEL_BG: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'bg-gray-500/10',
  [LogLevel.INFO]: 'bg-blue-500/10',
  [LogLevel.WARN]: 'bg-yellow-500/10',
  [LogLevel.ERROR]: 'bg-red-500/10',
  [LogLevel.FATAL]: 'bg-purple-500/10',
}

/** 日志级别简写 */
const LEVEL_SHORT: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DBG',
  [LogLevel.INFO]: 'INF',
  [LogLevel.WARN]: 'WRN',
  [LogLevel.ERROR]: 'ERR',
  [LogLevel.FATAL]: 'FTL',
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

/** 格式化日志时间 */
function formatLogTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

/** 格式化完整时间 */
function formatFullTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ts
  }
}

/** 获取 stepIndex（从 metadata 中提取） */
function getStepIndex(log: LogEntry): number | undefined {
  return log.metadata?.stepIndex as number | undefined
}

/** 按 agent-loop 轮次分组日志，未分组日志按时间戳插入轮次之间 */
function buildGroups(logs: LogEntry[]): LogGroup[] {
  const map = new Map<string, LogGroup>()
  const ungrouped: LogEntry[] = []

  for (const log of logs) {
    const si = getStepIndex(log)
    if (si !== undefined && si >= 0) {
      const key = String(si)
      let group = map.get(key)
      if (!group) {
        group = {
          key,
          stepIndex: si,
          entries: [],
          toolCallCount: 0,
          errorCount: 0,
        }
        map.set(key, group)
      }
      group.entries.push(log)
      if (log.type === LogType.TOOL_CALL) group.toolCallCount++
      if (log.level === LogLevel.ERROR || log.level === LogLevel.FATAL) group.errorCount++
      if (log.type === LogType.AGENT_LOOP) group.agentLoopLog = log
    } else {
      ungrouped.push(log)
    }
  }

  const rounds = Array.from(map.values()).sort((a, b) => a.stepIndex - b.stepIndex)

  if (ungrouped.length === 0) return rounds

  // 每个轮次取最早一条日志的时间戳作为位置标记
  const roundTimestamps = rounds.map(g => ({
    ts: g.entries[0]?.timestamp ?? '',
    group: g,
  }))

  // 按时间戳排序的 merged 列表: { ts, type: 'round' | 'log', group?, log? }
  type Slot = { ts: string; type: 'round'; group: LogGroup } | { ts: string; type: 'log'; log: LogEntry }
  const slots: Slot[] = [
    ...roundTimestamps.map(r => ({ ts: r.ts, type: 'round' as const, group: r.group })),
    ...ungrouped.map(l => ({ ts: l.timestamp, type: 'log' as const, log: l })),
  ]
  slots.sort((a, b) => a.ts.localeCompare(b.ts))

  // 合并相邻的非 round slot 为一个 __ungrouped__ 组，保留 round slot 原位
  const result: LogGroup[] = []
  let pendingUngrouped: LogEntry[] = []
  let ungroupedSeq = 0

  const flushUngrouped = () => {
    if (pendingUngrouped.length === 0) return
    result.push({
      key: `__ungrouped__${ungroupedSeq++}`,
      stepIndex: -1,
      entries: [...pendingUngrouped],
      toolCallCount: pendingUngrouped.filter(l => l.type === LogType.TOOL_CALL).length,
      errorCount: pendingUngrouped.filter(l => l.level === LogLevel.ERROR || l.level === LogLevel.FATAL).length,
    })
    pendingUngrouped = []
  }

  for (const slot of slots) {
    if (slot.type === 'round') {
      flushUngrouped()
      // 避免重复添加同一个 round（一个 round 可能被多次命中，用 stepIndex 去重）
      if (!result.some(g => g.key === slot.group.key)) {
        result.push(slot.group)
      }
    } else {
      pendingUngrouped.push(slot.log)
    }
  }
  flushUngrouped()

  return result
}

/** 会话日志组件属性 */
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

/** 分组结构 */
interface LogGroup {
  /** 分组键：stepIndex 或 ''(无分组) */
  key: string
  /** 轮次索引（从0开始），未分组为 -1 */
  stepIndex: number
  /** 该组日志条目 */
  entries: LogEntry[]
  /** 工具调用次数 */
  toolCallCount: number
  /** 错误数 */
  errorCount: number
  /** AgentLoop 步骤完成日志 */
  agentLoopLog?: LogEntry
}

/** 会话日志组件 */
export const SystemLogs = memo(function SystemLogs({
  conversationId,
  initialFilter,
  showFilter = true,
  showStats = true,
  showActions = true,
  maxHeight = '100%',
}: SystemLogsProps) {
  // 日志过滤（面板交互式过滤器）
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

  // 合并 props 过滤 + 面板过滤
  const combinedFilter = useMemo(
    () => ({ ...initialFilter, ...filter }),
    [initialFilter, filter]
  )
  const { logs, stats, loading, error, refreshLogs } = useLogState(combinedFilter, conversationId)

  // 日志导出
  const { exporting, exportLogs, downloadExport } = useLogExport()

  // 日志操作
  const { clearing, reporting, clearLogs, reportLogs } = useLogActions()

  // UI 状态
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [groupByRound, setGroupByRound] = useState(true)              // 是否按轮次分组
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())  // 展开的分组key
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set()) // 展开详情的条目id

  // 应用初始过滤器
  useEffect(() => {
    if (initialFilter) updateFilter(initialFilter)
  }, [initialFilter, updateFilter])

  // 应用会话ID过滤
  useEffect(() => {
    if (conversationId) updateFilter({ conversationId })
  }, [conversationId, updateFilter])

  // 默认展开所有分组（包括其他日志）
  useEffect(() => {
    if (!groupByRound) return
    const groups = buildGroups(logs)
    if (groups.length === 0) return
    setExpandedGroups(prev => {
      const next = new Set(prev)
      let changed = false
      for (const g of groups) {
        if (!next.has(g.key)) { next.add(g.key); changed = true }
      }
      return changed ? next : prev
    })
  }, [logs, groupByRound])

  // ── 分组逻辑 ──
  const groups = useMemo(() => buildGroups(logs), [logs])
  const groupCount = groups.length

  // ── 搜索 ──
  const handleSearch = (term: string) => {
    setSearchTerm(term)
    setSearch(term)
  }

  // ── 刷新/清空/上报/导出 ──
  const handleRefresh = () => refreshLogs()
  const handleClear = async () => {
    if (confirm('确定要清空所有日志吗？此操作不可恢复。')) {
      await clearLogs()
      refreshLogs()
    }
  }
  const handleReport = async () => { await reportLogs(); refreshLogs() }
  const handleExport = async (format: 'json' | 'csv' | 'text' | 'html') => {
    try {
      const result = await exportLogs({ format, filter, includeMetadata: true, includeDetails: true })
      downloadExport(result)
    } catch (err) { console.error('Export failed:', err) }
  }

  // ── 分组展开/折叠 ──
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const toggleEntry = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── 复制 ──
  const handleCopyLog = async (log: LogEntry) => {
    const text = `[${log.timestamp}] ${log.level.toUpperCase()} ${log.type}: ${log.message}`
    await navigator.clipboard.writeText(text)
  }
  const handleCopyAll = async () => {
    const text = logs.map(l => `[${l.timestamp}] ${l.level.toUpperCase()} ${l.type}: ${l.message}`).join('\n')
    await navigator.clipboard.writeText(text)
  }

  // ── 工具图标 ──
  const getToolIcon = (toolName: string) => {
    const Icon = TOOL_ICON_MAP[toolName] || Wrench
    return <Icon size={11} />
  }

  // ── 渲染单条紧凑日志行 ──
  const renderLogLine = (log: LogEntry) => {
    const isError = log.level === LogLevel.ERROR || log.level === LogLevel.FATAL
    const isToolCall = log.type === LogType.TOOL_CALL
    const toolName = isToolCall ? (log.details as any)?.toolName : null
    const isExpanded = expandedEntries.has(log.id)

    return (
      <div key={log.id} className="log-line group">
        {/* 主行：单行显示 */}
        <div
          className={`flex items-center gap-1.5 px-2 py-[2px] cursor-pointer select-none
            ${isError ? 'bg-red-500/[0.06]' : ''} 
            hover:bg-surface/60 transition-colors`}
          onClick={() => toggleEntry(log.id)}
        >
          {/* 展开指示器 */}
          <span className="w-3.5 flex-shrink-0 text-text-muted/50">
            {isExpanded
              ? <ChevronDown size={10} />
              : <ChevronRight size={10} />
            }
          </span>

          {/* 时间戳 */}
          <span className="text-[10px] text-text-muted/60 flex-shrink-0 w-14 tabular-nums">
            {formatLogTime(log.timestamp)}
          </span>

          {/* 级别标记 */}
          <span className={`text-[10px] font-semibold flex-shrink-0 w-7 ${LEVEL_COLORS[log.level]}`}>
            {LEVEL_SHORT[log.level]}
          </span>

          {/* 工具名称（有色小标记） */}
          {isToolCall && toolName && (
            <span className="inline-flex items-center gap-0.5 px-1 rounded text-[10px] bg-accent/10 text-accent flex-shrink-0 max-w-[72px] truncate">
              {getToolIcon(toolName)}
              <span className="truncate">{toolName}</span>
            </span>
          )}

          {/* 消息主体 — 单行截断 */}
          <span className={`text-[11px] truncate flex-1 min-w-0 ${isError ? 'text-red-400' : 'text-text-primary'}`}>
            {log.message}
          </span>

          {/* hover 操作 */}
          <button
            onClick={(e) => { e.stopPropagation(); handleCopyLog(log) }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface/80 transition-all text-text-muted/40 flex-shrink-0"
            title="复制"
          >
            <Copy size={10} />
          </button>
        </div>

        {/* 展开详情行 */}
        {isExpanded && (
          <div className="px-2 pb-1.5 ml-[22px] border-l border-border-subtle">
            <div className="pl-3">
              {/* 元信息 */}
              <div className="flex items-center gap-2 text-[10px] text-text-muted/70 pt-1">
                <span>{formatFullTime(log.timestamp)}</span>
                <span>|</span>
                <span>{log.type.replace(/_/g, ' ')}</span>
                <span>|</span>
                <span>{SOURCE_LABELS[log.source] || log.source}</span>
                {toolName && <span>| {toolName}</span>}
                {log.metadata?.durationMs != null && (
                  <span>| {log.metadata.durationMs}ms</span>
                )}
                <span className="text-text-muted/40">|</span>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    await navigator.clipboard.writeText(log.id)
                  }}
                  className="text-text-muted/40 hover:text-text-muted transition-colors font-mono"
                  title={`ID: ${log.id}\n点击复制`}
                >
                  {log.id.slice(0, 10)}…
                </button>
              </div>

              {/* 完整消息 */}
              <p className="text-[11px] text-text-primary font-mono whitespace-pre-wrap break-all mt-0.5">
                {log.message}
              </p>

              {/* details JSON */}
              {log.details && Object.keys(log.details).length > 0 && (
                <div className="text-[10px] text-text-muted mt-0.5">
                  <span className="text-text-muted/60">details</span>
                  <pre className="mt-0.5 p-1.5 bg-surface/30 rounded text-[10px] overflow-x-auto max-h-32">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </div>
              )}

              {/* metadata JSON */}
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <div className="text-[10px] text-text-muted">
                  <span className="text-text-muted/60">metadata</span>
                  <pre className="mt-0.5 p-1.5 bg-surface/30 rounded text-[10px] overflow-x-auto max-h-32">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {/* 标签 */}
              {log.tags && log.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {log.tags.map((tag, idx) => (
                    <span key={idx} className="px-1 py-px rounded text-[9px] bg-surface/50 text-text-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── 渲染分组头 ──
  const renderGroupHeader = (group: LogGroup) => {
    const isExpanded = expandedGroups.has(group.key)
    const isUngrouped = group.stepIndex < 0

    return (
      <div
        className={`flex items-center gap-2 px-2 py-1 cursor-pointer select-none sticky top-0 z-[5]
          ${isUngrouped ? 'bg-surface/40' : 'bg-surface/60'}
          border-b border-border-subtle hover:bg-surface/70 transition-colors`}
        onClick={() => toggleGroup(group.key)}
      >
        <span className="text-text-muted/60 flex-shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        <span className="text-[10px] font-semibold text-text-secondary flex-shrink-0">
          {isUngrouped ? '其他日志' : `第 ${group.stepIndex + 1} 轮`}
        </span>

        <span className="text-[10px] text-text-muted/60">
          {group.entries.length} 条
          {group.toolCallCount > 0 && ` · ${group.toolCallCount} 工具调用`}
          {group.errorCount > 0 && (
            <span className="text-red-500 ml-1">· {group.errorCount} 错误</span>
          )}
        </span>

        {/* Agent loop 摘要信息 */}
        {group.agentLoopLog && (
          <span className="text-[10px] text-text-muted/50 truncate ml-auto">
            {(group.agentLoopLog.details as any)?.finishReason && 
              `结束: ${(group.agentLoopLog.details as any).finishReason}`}
          </span>
        )}
      </div>
    )
  }

  // ── 统计栏 ──
  const renderStats = () => {
    if (!stats) return null
    return (
      <div className="px-2 py-1 border-b border-border-subtle bg-background flex items-center gap-3 sticky top-0 z-10">
        <span className="text-[10px] text-text-muted">
          共 <span className="font-semibold text-text-secondary">{stats.total}</span> 条
        </span>
        {groupByRound && groupCount > 0 && (
          <span className="text-[10px] text-text-muted">
            <span className="font-semibold text-text-secondary">{groupCount}</span> 轮
          </span>
        )}
        {stats.errorRate > 0 && (
          <span className="text-[10px] text-red-500">
            错误 {(stats.errorRate * 100).toFixed(0)}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setGroupByRound(!groupByRound)}
            className={`p-1 rounded transition-colors ${groupByRound ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
            title={groupByRound ? '平铺视图' : '分组视图'}
          >
            {groupByRound ? <Layers size={11} /> : <List size={11} />}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted hover:text-text-secondary disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    )
  }

  // ── 过滤器面板 ──
  const renderFilterPanel = () => {
    if (!showFilterPanel) return null
    return (
      <div className="px-2 py-1.5 border-b border-border-subtle bg-surface/30">
        <div className="flex items-center gap-2 mb-1.5">
          <Filter size={10} className="text-text-muted" />
          <span className="text-[10px] font-medium text-text-secondary">过滤器</span>
          <button onClick={resetFilter} className="ml-auto text-[10px] text-text-muted hover:text-text-secondary">重置</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.values(LogLevel).map(level => (
            <button key={level} onClick={() => filter.level?.includes(level) ? removeLevelFilter(level) : addLevelFilter(level)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                filter.level?.includes(level) ? `${LEVEL_COLORS[level]} ${LEVEL_BG[level]}` : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}>{LEVEL_SHORT[level]}</button>
          ))}
          {Object.values(LogType).map(type => (
            <button key={type} onClick={() => filter.type?.includes(type) ? removeTypeFilter(type) : addTypeFilter(type)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                filter.type?.includes(type) ? 'bg-accent/10 text-accent' : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}>{type}</button>
          ))}
          {Object.values(LogSource).map(source => (
            <button key={source} onClick={() => filter.source?.includes(source) ? removeSourceFilter(source) : addSourceFilter(source)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                filter.source?.includes(source) ? 'bg-green-500/10 text-green-500' : 'bg-surface/50 text-text-muted hover:bg-surface/80'
              }`}>{SOURCE_LABELS[source]}</button>
          ))}
        </div>
      </div>
    )
  }

  // ── 操作栏 ──
  const renderActions = () => {
    if (!showActions) return null
    return (
      <div className="px-2 py-1 border-b border-border-subtle bg-background flex items-center gap-1.5 sticky top-0 z-10">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" placeholder="搜索..." value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[10px] bg-surface/50 border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button onClick={() => setShowFilterPanel(!showFilterPanel)}
          className={`p-1 rounded transition-colors ${showFilterPanel ? 'bg-accent/10 text-accent' : 'hover:bg-surface/60 text-text-muted'}`}
          title="过滤器"><Filter size={11} /></button>
        <button onClick={handleReport} disabled={reporting}
          className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted disabled:opacity-50"
          title="上报"><Upload size={11} /></button>
        <div className="relative group">
          <button disabled={exporting}
            className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted disabled:opacity-50"
            title="导出"><Download size={11} /></button>
          <div className="absolute right-0 top-full mt-1 w-28 bg-background border border-border-subtle rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
            {(['json','csv','text','html'] as const).map(f => (
              <button key={f} onClick={() => handleExport(f)}
                className="w-full px-2 py-1 text-[10px] text-left hover:bg-surface/50">{f.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <button onClick={handleCopyAll} className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted" title="复制全部"><Copy size={11} /></button>
        <button onClick={handleClear} disabled={clearing}
          className="p-1 rounded hover:bg-surface/60 transition-colors text-text-muted disabled:opacity-50" title="清空"><Trash2 size={11} /></button>
      </div>
    )
  }

  // ── 主渲染 ──
  return (
    <div className="flex flex-col h-full" style={{ maxHeight }}>
      {showStats && renderStats()}
      {renderActions()}
      {renderFilterPanel()}

      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <RefreshCw size={28} className="text-text-muted mb-2 opacity-50 animate-spin" />
            <p className="text-xs text-text-muted">加载中...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <AlertCircle size={28} className="text-red-500 mb-2 opacity-50" />
            <p className="text-xs text-red-500">加载失败</p>
            <p className="text-[10px] text-text-muted mt-0.5">{error?.message}</p>
            <button onClick={handleRefresh} className="mt-2 px-2 py-1 text-[10px] bg-surface/50 rounded hover:bg-surface/80">重试</button>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <ScrollText size={28} className="text-text-muted mb-2 opacity-50" />
            <p className="text-xs text-text-muted">暂无会话日志</p>
          </div>
        ) : groupByRound ? (
          /* 分组视图 */
          groups.map(group => (
            <div key={group.key}>
              {renderGroupHeader(group)}
              {expandedGroups.has(group.key) && group.entries.map(log => renderLogLine(log))}
            </div>
          ))
        ) : (
          /* 平铺视图 */
          logs.map(log => renderLogLine(log))
        )}
      </div>
    </div>
  )
})

/** 导出组件 */
export default SystemLogs