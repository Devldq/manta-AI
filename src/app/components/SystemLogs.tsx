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
  MessageSquare,
} from 'lucide-react'
import { useLogState, useLogFilter, useLogExport, useLogActions } from '@observability/log/hooks'
import { LogEntry, LogLevel, LogType, LogSource, LogFilter } from '@observability/log/types'
import { MetricsDashboard } from './MetricsDashboard'

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

/** 获取 messageId（从 metadata 中提取） */
function getMessageId(log: LogEntry): string | undefined {
  return log.metadata?.messageId as string | undefined
}

/** 获取 prompt（从 metadata 中提取） */
function getPrompt(log: LogEntry): string | undefined {
  return log.metadata?.prompt as string | undefined
}

/** 将一组日志按 stepIndex 分组为 LogGroup[] */
function buildStepGroups(turnLogs: LogEntry[]): { steps: LogGroup[]; ungrouped: LogEntry[] } {
  const map = new Map<string, LogGroup>()
  const ungrouped: LogEntry[] = []

  for (const log of turnLogs) {
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
          modelOutputCount: 0,
        }
        map.set(key, group)
      }
      group.entries.push(log)
      if (log.type === LogType.TOOL_CALL) group.toolCallCount++
      if (log.level === LogLevel.ERROR || log.level === LogLevel.FATAL) group.errorCount++
      if (log.type === LogType.MODEL_OUTPUT) group.modelOutputCount++
      if (log.type === LogType.AGENT_LOOP) group.agentLoopLog = log
    } else {
      ungrouped.push(log)
    }
  }

  // 每个 step 内按时间升序排列
  for (const group of map.values()) {
    group.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  // 按 stepIndex 升序排列（自然顺序：Step 1 → Step 2 → …）
  const steps = Array.from(map.values()).sort((a, b) => a.stepIndex - b.stepIndex)
  return { steps, ungrouped }
}

/**
 * 两级分组：先按对话轮次（messageId）分组，再在每轮内按 stepIndex 分组。
 * 返回 TurnGroup[]，按时间倒序排列（最新的轮次在前）。
 */
function buildTurnGroups(logs: LogEntry[]): { turns: TurnGroup[]; globalUngrouped: LogEntry[] } {
  // 第一级：按 messageId 分组
  const turnMap = new Map<string, LogEntry[]>()
  const globalUngrouped: LogEntry[] = []

  for (const log of logs) {
    const mid = getMessageId(log)
    if (mid) {
      const existing = turnMap.get(mid)
      if (existing) {
        existing.push(log)
      } else {
        turnMap.set(mid, [log])
      }
    } else {
      globalUngrouped.push(log)
    }
  }

  // 第二级：每个轮次内按 stepIndex 分组
  const turns: TurnGroup[] = []

  for (const [messageId, turnLogs] of turnMap.entries()) {
    // 从任意一条日志的 metadata 中提取 prompt
    const prompt = turnLogs
      .map(getPrompt)
      .find(p => p !== undefined)

    const { steps, ungrouped } = buildStepGroups(turnLogs)

    // 将无 stepIndex 的日志按时间拆分为 init（loop 前）和 completion（loop 后）两段
    let initLogs: LogEntry[] = []
    let completionLogs: LogEntry[] = []

    if (steps.length > 0) {
      // 找到第一轮 loop 的最早时间 和 最后一轮 loop 的最晚时间
      let loopStartTs = ''
      let loopEndTs = ''
      for (const step of steps) {
        for (const entry of step.entries) {
          if (!loopStartTs || entry.timestamp < loopStartTs) loopStartTs = entry.timestamp
          if (!loopEndTs || entry.timestamp > loopEndTs) loopEndTs = entry.timestamp
        }
      }

      initLogs = ungrouped.filter(e => e.timestamp < loopStartTs).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      completionLogs = ungrouped.filter(e => e.timestamp > loopEndTs).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    } else {
      // 没有 step 分组时，所有 ungrouped 归入 init（单次对话可能只有初始化日志）
      initLogs = [...ungrouped].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    }

    const totalEntries = turnLogs.length
    const toolCallCount = turnLogs.filter(l => l.type === LogType.TOOL_CALL).length
    const errorCount = turnLogs.filter(l => l.level === LogLevel.ERROR || l.level === LogLevel.FATAL).length

    turns.push({
      key: messageId,
      messageId,
      prompt,
      steps,
      initLogs,
      completionLogs,
      totalEntries,
      toolCallCount,
      errorCount,
    })
  }

  // 找每轮最新日志的时间戳用于倒序排序
  const latestTs = (turnLogs: LogEntry[]) => {
    let latest = ''
    for (const l of turnLogs) {
      if (l.timestamp > latest) latest = l.timestamp
    }
    return latest
  }

  turns.sort((a, b) => {
    const aLogs = turnMap.get(a.messageId) ?? []
    const bLogs = turnMap.get(b.messageId) ?? []
    return latestTs(bLogs).localeCompare(latestTs(aLogs))
  })

  globalUngrouped.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  return { turns, globalUngrouped }
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

/** Step 分组结构 */
interface LogGroup {
  /** 分组键：stepIndex 或 ''(无分组) */
  key: string
  /** 步骤索引（从0开始），未分组为 -1 */
  stepIndex: number
  /** 该组日志条目 */
  entries: LogEntry[]
  /** 工具调用次数 */
  toolCallCount: number
  /** 错误数 */
  errorCount: number
  /** 模型输出次数 */
  modelOutputCount: number
  /** AgentLoop 步骤完成日志 */
  agentLoopLog?: LogEntry
}

/** 对话轮次分组结构 */
interface TurnGroup {
  /** 分组键：messageId */
  key: string
  /** 消息ID（对应一轮 agent loop） */
  messageId: string
  /** 用户提问内容 */
  prompt?: string
  /** 该轮次下的 Step 分组（按 stepIndex 排序） */
  steps: LogGroup[]
  /** 该轮次下 Agent 初始化阶段的日志（在第一轮 loop 之前） */
  initLogs: LogEntry[]
  /** 该轮次下 Agent 结束阶段的日志（在最后一轮 loop 之后） */
  completionLogs: LogEntry[]
  /** 该轮次的总日志条数 */
  totalEntries: number
  /** 该轮次的工具调用次数 */
  toolCallCount: number
  /** 该轮次的错误数 */
  errorCount: number
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
  const [groupByRound, setGroupByRound] = useState(true)              // 是否按轮次+步骤分组
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set())    // 展开的轮次key（messageId）
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())   // 展开的步骤key（messageId:stepIndex）
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set()) // 展开详情的条目id

  // 应用初始过滤器
  useEffect(() => {
    if (initialFilter) updateFilter(initialFilter)
  }, [initialFilter, updateFilter])

  // 应用会话ID过滤
  useEffect(() => {
    if (conversationId) updateFilter({ conversationId })
  }, [conversationId, updateFilter])

  // 默认展开所有轮次和步骤
  useEffect(() => {
    if (!groupByRound) return
    const { turns } = buildTurnGroups(logs)
    if (turns.length === 0) return

    // 展开所有轮次
    setExpandedTurns(prev => {
      const next = new Set(prev)
      let changed = false
      for (const t of turns) {
        if (!next.has(t.key)) { next.add(t.key); changed = true }
      }
      return changed ? next : prev
    })

    // 展开所有步骤
    setExpandedSteps(prev => {
      const next = new Set(prev)
      let changed = false
      for (const t of turns) {
        for (const s of t.steps) {
          const stepKey = `${t.messageId}:${s.stepIndex}`
          if (!next.has(stepKey)) { next.add(stepKey); changed = true }
        }
      }
      return changed ? next : prev
    })
  }, [logs, groupByRound])

  // ── 分组逻辑（两级：轮次 → 步骤） ──
  const { turns, globalUngrouped } = useMemo(() => {
    const result = buildTurnGroups(logs)
    return result
  }, [logs])

  // ── 将全局未分组日志按时间拆分为 init / completion ──
  const { globalInitLogs, globalCompletionLogs } = useMemo(() => {
    let init: LogEntry[] = []
    let completion: LogEntry[] = []

    if (turns.length > 0 && globalUngrouped.length > 0) {
      // 以第一轮 init 开始为分界线：比第一轮最早日志还早的 → 全局 init
      // 以最后一轮 completion 结束为分界线：比最后一轮最晚日志还晚的 → 全局 completion
      const firstTurn = turns[turns.length - 1] // turns 是倒序的，最后一个是最早的
      const lastTurn = turns[0] // 第一个是最晚的

      let allTurnStart = ''
      let allTurnEnd = ''

      // 最早上轮次的最早 init 日志或最早 step 日志
      for (const e of [...firstTurn.initLogs, ...firstTurn.steps.flatMap(s => s.entries)]) {
        if (!allTurnStart || e.timestamp < allTurnStart) allTurnStart = e.timestamp
      }
      // 最晚上轮次的最晚 completion 日志或最晚 step 日志
      for (const e of [...lastTurn.completionLogs, ...lastTurn.steps.flatMap(s => s.entries)]) {
        if (!allTurnEnd || e.timestamp > allTurnEnd) allTurnEnd = e.timestamp
      }

      init = globalUngrouped.filter(e => e.timestamp < allTurnStart).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      completion = globalUngrouped.filter(e => e.timestamp > allTurnEnd).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    } else if (globalUngrouped.length > 0) {
      // 没有轮次时全部归入 init
      init = [...globalUngrouped].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    }

    return { globalInitLogs: init, globalCompletionLogs: completion }
  }, [globalUngrouped, turns])
  const turnCount = turns.length
  const totalStepCount = turns.reduce((n, t) => n + t.steps.length, 0)

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

  // ── 轮次/步骤展开折叠 ──
  const toggleTurn = (messageId: string) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId)
      return next
    })
  }
  const toggleStep = (messageId: string, stepIndex: number) => {
    const key = `${messageId}:${stepIndex}`
    setExpandedSteps(prev => {
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
    const parts: string[] = []

    // 基础行：时间戳 + 级别 + 类型 + 消息
    parts.push(`[${log.timestamp}] ${log.level.toUpperCase()} ${log.type}: ${log.message}`)

    // details
    if (log.details && Object.keys(log.details).length > 0) {
      parts.push('')
      parts.push('details:')
      parts.push(JSON.stringify(log.details, null, 2))
    }

    // metadata
    if (log.metadata && Object.keys(log.metadata).length > 0) {
      parts.push('')
      parts.push('metadata:')
      parts.push(JSON.stringify(log.metadata, null, 2))
    }

    const text = parts.join('\n')
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
    const isModelOutput = log.type === LogType.MODEL_OUTPUT
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

          {/* 模型输出标记 */}
          {isModelOutput && (
            <span className="inline-flex items-center gap-0.5 px-1 rounded text-[10px] bg-green-500/10 text-green-500 flex-shrink-0" title="模型输出">
              <MessageSquare size={11} />
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

  // ── 渲染轮次头（一级分组） ──
  const renderTurnHeader = (turn: TurnGroup, index: number, total: number) => {
    const isExpanded = expandedTurns.has(turn.key)
    const promptPreview = turn.prompt
      ? (turn.prompt.length > 40 ? turn.prompt.slice(0, 40) + '…' : turn.prompt)
      : '(无提问内容)'

    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none sticky top-0 z-10
          bg-surface border-b-2 border-accent/40 hover:bg-accent/10 transition-colors`}
        onClick={() => toggleTurn(turn.key)}
      >
        <span className="text-accent flex-shrink-0">
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>

        <span className="text-[11px] font-bold text-text-primary flex-shrink-0">
          第 {total - index} 轮对话
        </span>

        <span className="text-[11px] text-text-secondary truncate flex-1 min-w-0" title={turn.prompt}>
          {promptPreview}
        </span>

        <span className="text-[10px] text-text-muted/60 flex-shrink-0">
          {turn.steps.length} 步 · {turn.totalEntries} 条
          {turn.toolCallCount > 0 && ` · ${turn.toolCallCount} 工具`}
          {turn.errorCount > 0 && (
            <span className="text-red-500 ml-1">· {turn.errorCount} 错误</span>
          )}
        </span>
      </div>
    )
  }

  /** 格式化 token 数：≥10000 显示为 x.xw */
  function fmtTokens(n: number): string {
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
    return String(n)
  }

  /** 从 agentLoopLog 中提取 stepUsage */
  function getStepUsage(group: LogGroup): { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number } | null {
    // 优先从 agentLoopLog.details.stepUsage 取
    if (group.agentLoopLog) {
      const su = (group.agentLoopLog.details as any)?.stepUsage
      if (su) return su
    }
    // 备选：从 modelOutput 日志的 metadata.usage 取
    const modelLog = group.entries.find(l => l.type === LogType.MODEL_OUTPUT)
    if (modelLog?.metadata?.usage) {
      const u = modelLog.metadata.usage as any
      return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.cacheReadTokens, noCacheTokens: u.noCacheTokens }
    }
    return null
  }

  // ── 渲染步骤头（二级分组） ──
  const renderStepHeader = (group: LogGroup, messageId: string) => {
    const stepKey = `${messageId}:${group.stepIndex}`
    const isExpanded = expandedSteps.has(stepKey)
    const stepUsage = getStepUsage(group)

    // token 彩色数字
    let tokenInfo = null
    if (stepUsage) {
      const noCache = stepUsage.noCacheTokens ?? stepUsage.inputTokens
      const cache = stepUsage.cacheReadTokens ?? 0
      const out = stepUsage.outputTokens
      const total = noCache + cache + out

      tokenInfo = (
        <span
          className="text-[9px] font-mono whitespace-nowrap flex-shrink-0 ml-auto"
          title={`Input: ${noCache.toLocaleString()}  |  Cache: ${cache.toLocaleString()}  |  Output: ${out.toLocaleString()}  |  Total: ${total.toLocaleString()}`}
        >
          {noCache > 0 && <span style={{ color: 'var(--color-accent, #6366f1)' }}>{fmtTokens(noCache)}</span>}
          {cache > 0 && <span style={{ color: 'var(--color-status-done, #10b981)' }}>+{fmtTokens(cache)}</span>}
          {out > 0 && <span style={{ color: 'var(--color-warning, #f59e0b)' }}>→{fmtTokens(out)}</span>}
        </span>
      )
    }

    return (
      <div
        className={`flex items-center gap-2 px-2 py-[3px] cursor-pointer select-none
          bg-surface/40 border-b border-border-subtle/50 hover:bg-surface/60 transition-colors`}
        onClick={(e) => { e.stopPropagation(); toggleStep(messageId, group.stepIndex) }}
      >
        <span className="text-text-muted/50 flex-shrink-0">
          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>

        <span className="text-[10px] font-semibold text-text-secondary flex-shrink-0">
          Step {group.stepIndex + 1}
        </span>

      <span className="text-[10px] text-text-muted/60">
        {group.entries.length} 条
        {group.toolCallCount > 0 && ` · ${group.toolCallCount} 工具调用`}
        {group.modelOutputCount > 0 && ` · ${group.modelOutputCount} 输出`}
        {group.errorCount > 0 && (
          <span className="text-red-500 ml-1">· {group.errorCount} 错误</span>
        )}
      </span>

        {/* token 彩色数字 */}
        {tokenInfo}

        {/* 无 usage 时兜底显示 finishReason */}
        {!tokenInfo && group.agentLoopLog && (
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
        {groupByRound && turnCount > 0 && (
          <span className="text-[10px] text-text-muted">
            <span className="font-semibold text-text-secondary">{turnCount}</span> 轮对话
          </span>
        )}
        {groupByRound && totalStepCount > 0 && (
          <span className="text-[10px] text-text-muted">
            <span className="font-semibold text-text-secondary">{totalStepCount}</span> 步骤
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
      <MetricsDashboard conversationId={conversationId} />
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
          /* 两级分组视图：全局初始化 → 轮次[init → steps → completion] → 全局结束 */
          <>
            {/* 全局初始化日志（在所有轮次之前，无 messageId） */}
            {globalInitLogs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-2 py-1 bg-surface/50 border-b border-border-subtle">
                  <span className="text-[10px] font-semibold text-text-muted">Agent 初始化</span>
                  <span className="text-[10px] text-text-muted/50">{globalInitLogs.length} 条</span>
                </div>
                {globalInitLogs.map(log => renderLogLine(log))}
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={turn.key}>
                {renderTurnHeader(turn, i, turns.length)}

                {expandedTurns.has(turn.key) && (
                  <div className="ml-2 border-l border-border-subtle/60">
                    {/* 该轮次下初始化阶段日志（第一轮 loop 之前） */}
                    {turn.initLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 px-2 py-[3px] bg-surface/30 border-b border-border-subtle/30">
                          <span className="text-[10px] text-text-muted/50">Agent 初始化</span>
                          <span className="text-[10px] text-text-muted/40">{turn.initLogs.length} 条</span>
                        </div>
                        {turn.initLogs.map(log => renderLogLine(log))}
                      </div>
                    )}
                    {/* 该轮次下的 Step 分组 */}
                    {turn.steps.map(step => (
                      <div key={`${turn.messageId}:${step.stepIndex}`}>
                        {renderStepHeader(step, turn.messageId)}
                        {expandedSteps.has(`${turn.messageId}:${step.stepIndex}`) && (
                          <div className="ml-3 border-l border-accent/30">
                            {step.entries.map(log => renderLogLine(log))}
                          </div>
                        )}
                      </div>
                    ))}
                    {/* 该轮次下结束阶段日志（最后一轮 loop 之后） */}
                    {turn.completionLogs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 px-2 py-[3px] bg-surface/30 border-b border-border-subtle/30">
                          <span className="text-[10px] text-text-muted/50">Agent 结束</span>
                          <span className="text-[10px] text-text-muted/40">{turn.completionLogs.length} 条</span>
                        </div>
                        {turn.completionLogs.map(log => renderLogLine(log))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {/* 全局结束日志（在所有轮次之后，无 messageId） */}
            {globalCompletionLogs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-2 py-1 bg-surface/50 border-b border-border-subtle">
                  <span className="text-[10px] font-semibold text-text-muted">Agent 结束</span>
                  <span className="text-[10px] text-text-muted/50">{globalCompletionLogs.length} 条</span>
                </div>
                {globalCompletionLogs.map(log => renderLogLine(log))}
              </div>
            )}
          </>
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