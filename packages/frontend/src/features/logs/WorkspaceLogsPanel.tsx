import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useWorkspaceLogs } from './useWorkspaceLogs'
import { filterWorkspaceLogs, groupWorkspaceLogs } from './workspace-logs'
import type { WorkspaceLogEntry, WorkspaceLogLevelFilter } from './types'

interface WorkspaceLogsPanelProps {
  conversationId?: string
  workspaceId?: string | null
}

const LEVEL_OPTIONS: Array<{ value: WorkspaceLogLevelFilter; label: string }> = [
  { value: 'all', label: '全部级别' },
  { value: 'error', label: '错误' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
  { value: 'debug', label: '调试' },
]

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function LogEntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: WorkspaceLogEntry
  expanded: boolean
  onToggle: () => void
}) {
  const hasDetails = Boolean(
    (entry.details && Object.keys(entry.details).length > 0)
    || (entry.metadata && Object.keys(entry.metadata).length > 0),
  )
  return (
    <div className={`workspace-log-entry is-${entry.level}`}>
      <button
        type="button"
        className="workspace-log-entry-line"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!hasDetails}
      >
        <span className="workspace-log-entry-chevron">
          {hasDetails ? (expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        </span>
        <time dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
        <span className={`workspace-log-level is-${entry.level}`}>{entry.level.slice(0, 4).toUpperCase()}</span>
        <span className="workspace-log-message">{entry.message}</span>
      </button>
      {expanded && hasDetails && (
        <div className="workspace-log-entry-details">
          <div className="workspace-log-entry-meta">
            <span>{entry.type}</span>
            <span>{entry.source}</span>
            {typeof entry.metadata?.durationMs === 'number' && <span>{entry.metadata.durationMs} ms</span>}
          </div>
          {entry.details && <pre>{JSON.stringify(entry.details, null, 2)}</pre>}
          {entry.metadata && <pre>{JSON.stringify(entry.metadata, null, 2)}</pre>}
        </div>
      )}
    </div>
  )
}

export function WorkspaceLogsPanel({ conversationId, workspaceId }: WorkspaceLogsPanelProps) {
  const { logs, loading, error, connected, refresh } = useWorkspaceLogs({ conversationId, workspaceId })
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<WorkspaceLogLevelFilter>('all')
  const [type, setType] = useState('all')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['__first__']))
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set())

  const types = useMemo(() => [...new Set(logs.map((entry) => entry.type))].sort(), [logs])
  const filtered = useMemo(() => filterWorkspaceLogs(logs, search, level, type), [level, logs, search, type])
  const groups = useMemo(() => groupWorkspaceLogs(filtered), [filtered])

  useEffect(() => {
    setExpandedGroups(new Set(['__first__']))
    setExpandedEntries(new Set())
  }, [conversationId])

  const toggleGroup = (key: string, expanded: boolean) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      next.delete('__first__')
      if (expanded) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleEntry = (id: string) => {
    setExpandedEntries((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!conversationId) {
    return <div className="workspace-logs-empty">选择一个会话后查看运行日志。</div>
  }

  return (
    <section className="workspace-logs-panel" aria-label="工作区日志">
      <div className="workspace-logs-toolbar">
        <label className="workspace-logs-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索日志"
            aria-label="搜索日志"
          />
        </label>
        <button type="button" className="workspace-logs-refresh" onClick={refresh} aria-label="刷新日志" title="刷新日志">
          <RefreshCw size={13} className={loading ? 'tool-spinner' : undefined} />
        </button>
      </div>
      <div className="workspace-logs-filters">
        <select value={level} onChange={(event) => setLevel(event.target.value as WorkspaceLogLevelFilter)} aria-label="按级别过滤">
          {LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="按类型过滤">
          <option value="all">全部类型</option>
          {types.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <span className={`workspace-logs-connection ${connected ? 'is-live' : ''}`}>
          <CircleDot size={10} />{connected ? '实时' : '重连中'}
        </span>
        <span className="workspace-logs-count">{filtered.length}/{logs.length}</span>
      </div>

      {error && (
        <div className="workspace-logs-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button type="button" onClick={refresh}>重试</button>
        </div>
      )}
      {loading && logs.length === 0 && <div className="workspace-logs-empty">正在加载最近日志…</div>}
      {!loading && !error && logs.length === 0 && <div className="workspace-logs-empty">当前会话还没有日志。</div>}
      {logs.length > 0 && filtered.length === 0 && <div className="workspace-logs-empty">没有匹配当前筛选条件的日志。</div>}

      <div className="workspace-log-groups">
        {groups.map((group, index) => {
          const expanded = expandedGroups.has(group.key) || (expandedGroups.has('__first__') && index === 0)
          return (
            <div className="workspace-log-group" key={group.key}>
              <button
                type="button"
                className="workspace-log-group-header"
                onClick={() => toggleGroup(group.key, expanded)}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <strong>{group.label}</strong>
                {group.messageId && <span title={group.messageId}>{group.messageId.slice(0, 8)}</span>}
                <span>{group.entries.length} 条</span>
                {group.errorCount > 0 && <span className="is-error">{group.errorCount} 错误</span>}
                <time dateTime={group.latestAt}>{formatTime(group.latestAt)}</time>
              </button>
              {expanded && (
                <div className="workspace-log-group-entries">
                  {group.entries.map((entry) => (
                    <LogEntryRow
                      key={entry.id}
                      entry={entry}
                      expanded={expandedEntries.has(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
