/* 会话侧边栏 — 展示本次会话的修改内容和变更文件 */
'use client'

import React, { useState, useEffect, useRef, memo, useMemo } from 'react'
import { FileEdit, FileText, ScrollText, Check, X, Loader2, Clock, Folder, FileSearch, Search, Terminal, FileCode, Wrench, Pencil, ChevronDown, Copy, ClipboardCheck } from 'lucide-react'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 工具调用记录（来自持久化的会话数据） */
export interface StoredToolCall {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

/** 消息记录 */
export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: StoredToolCall[]
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** 会话数据 */
export interface ConversationData {
  id: string
  title: string
  agentName: string
  messages: StoredMessage[]
  createdAt: string
  updatedAt: string
}

/** 修改内容记录 */
export interface FileChange {
  filePath: string
  changeType: 'create' | 'edit' | 'delete'
  timestamp: string
  description?: string
}

/** 侧边栏标签页 */
type TabId = 'changes' | 'files' | 'logs'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const SIDEBAR_MIN_WIDTH = 360
const SIDEBAR_MAX_WIDTH = 600
const SIDEBAR_WIDTH_KEY = 'manta:session-sidebar-width'

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

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

function formatLogTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/** 格式化 token 数：≥10000 显示为 x.xw */
function fmtTokens(n: number | undefined): string {
  if (n === undefined || n === 0) return ''
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return String(n)
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  return (obj.file_path as string) || (obj.path as string) || null
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface SessionSidebarProps {
  /** 侧边栏是否打开 */
  open: boolean
  /** 会话数据 */
  conversation: ConversationData | null
}

export const SessionSidebar = memo(function SessionSidebar({
  open,
  conversation,
}: SessionSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('logs')
  const [width, setWidth] = useState(420)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const isInitialized = useRef(false)

  // 从 localStorage 恢复宽度
  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (saved) {
      const n = Number(saved)
      if (n >= SIDEBAR_MIN_WIDTH && n <= SIDEBAR_MAX_WIDTH) setWidth(n)
    }
  }, [])

  // 拖拽处理
  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    setIsDragging(true)

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - dragStartX.current
      const newWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, dragStartWidth.current - delta)
      )
      setWidth(newWidth)
    }

    function onMouseUp() {
      setIsDragging(false)
      setWidth((prev) => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(prev))
        return prev
      })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    // 侧边栏作为 flex 子元素，open 控制宽度/显示
    <div
      className="flex flex-col bg-background border-l border-border h-full relative"
      style={{
        width: open ? `${width}px` : '0px',
        minWidth: open ? `${width}px` : '0px',
        overflow: 'hidden',
        transition: isDragging ? 'none' : 'width 0.25s ease, min-width 0.25s ease',
        flexShrink: 0,
      }}
    >
      {/* 左边缘拖拽手柄 - 始终显示但仅展开时可交互 */}
      <div
        onMouseDown={open ? handleResizeMouseDown : undefined}
        className="absolute left-0 top-0 h-full w-2 z-10 group cursor-col-resize select-none flex items-center"
        style={{ 
          cursor: open ? 'col-resize' : 'default',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div
          className="w-1 h-full transition-colors"
          style={{ backgroundColor: isDragging ? 'var(--color-accent)' : 'transparent' }}
        />
        <div
          className="w-1 h-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'var(--color-accent)' }}
        />
      </div>

      {/* 内容区 - 左侧留出拖拽区域 */}
      <div className="flex flex-col h-full ml-2" style={{ width: `calc(100% - 8px)` }}>
        {/* 标签切换 */}
        <div className="flex border-b border-border flex-shrink-0">
          {[
            { id: 'changes' as TabId, label: '修改内容', icon: FileEdit },
            { id: 'files' as TabId, label: '变更文件', icon: FileText },
            { id: 'logs' as TabId, label: '工具日志', icon: ScrollText },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'changes' && (
            <FileChanges conversation={conversation} />
          )}
          {activeTab === 'files' && (
            <ChangedFiles conversation={conversation} />
          )}
          {activeTab === 'logs' && (
            <ToolLogs conversation={conversation} />
          )}
        </div>
      </div>

      {isDragging && (
        <style>{`* { user-select: none !important; cursor: col-resize !important; }`}</style>
      )}
    </div>
  )
})

// ─── 修改内容面板 ──────────────────────────────────────────────────────────────

function FileChanges({ conversation }: { conversation: ConversationData | null }) {
  // 从工具调用中提取修改内容
  const changes: FileChange[] = []

  if (conversation) {
    for (const msg of conversation.messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const filePath = extractFilePath(tc.input)
          if (filePath && (tc.toolName === 'write' || tc.toolName === 'edit' || tc.toolName === 'multiEdit')) {
            changes.push({
              filePath,
              changeType: tc.output ? 'edit' : 'create',
              timestamp: msg.timestamp,
              description: tc.output
                ? truncateText(JSON.stringify(tc.output), 100)
                : undefined,
            })
          }
        }
      }
    }
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <FileEdit size={32} className="text-text-muted mb-3 opacity-50" />
        <p className="text-sm text-text-muted">暂无修改内容</p>
        <p className="text-xs text-text-muted mt-1">Agent 修改文件后，这里将显示变更记录</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {changes.map((change, idx) => (
        <div
          key={`${change.filePath}-${idx}`}
          className={`px-4 py-2.5 border-b border-border-subtle ${
            idx === 0 ? 'border-t border-border' : ''
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
              change.changeType === 'create'
                ? 'bg-status-done/10 text-status-done'
                : change.changeType === 'edit'
                ? 'bg-accent/10 text-accent'
                : 'bg-status-failed/10 text-status-failed'
            }`}>
              {change.changeType === 'create' ? '创建' : change.changeType === 'edit' ? '编辑' : '删除'}
            </span>
            <span className="text-xs text-text-secondary font-mono truncate flex-1">
              {change.filePath.split('/').pop()}
            </span>
          </div>
          <p className="text-[11px] text-text-muted font-mono truncate" title={change.filePath}>
            {change.filePath}
          </p>
          {change.description && (
            <p className="text-[10px] text-text-muted mt-1 line-clamp-2">
              {change.description}
            </p>
          )}
          <span className="text-[10px] text-text-muted mt-1 block">
            {formatRelativeTime(change.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── 工具日志面板 ──────────────────────────────────────────────────────────────

/** 工具名 → lucide icon 映射 */
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

function getToolIcon(toolName: string) {
  return TOOL_ICON_MAP[toolName] ?? Wrench
}

/** 将任意值截断为可读字符串 */
function fmtVal(v: unknown, maxLen = 200): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

/** 根据工具调用生成模拟的日志行（仿 fs-tools console.log 风格） */
function generateLogLines(tc: StoredToolCall): string[] {
  const lines: string[] = []
  const input = (tc.input ?? {}) as Record<string, unknown>
  const tag = `[fs-tools:${tc.toolName}]`

  switch (tc.toolName) {
    case 'lsDir': {
      const p = String(input.dir_path ?? input.path ?? '')
      lines.push(`${tag} 开始执行, raw input: { path: '${p}' }`)
      lines.push(`${tag} 解析后 params: { path: '${p}' }`)
      lines.push(`${tag} targetPath: ${p}`)
      lines.push(`[fs-tools] checkAccess: ${p} → ${p}`)
      lines.push(`[fs-tools] isApproved: true`)
      lines.push(`[fs-tools] ✓ 已授权，直接访问`)
      lines.push(`${tag} resolved: ${p}`)
      lines.push(`${tag} existsSync: true`)
      lines.push(`${tag} 调用 statSync...`)
      lines.push(`${tag} isDirectory: true`)
      lines.push(`${tag} 调用 readdirSync...`)
      const output = tc.output as Record<string, unknown> | undefined
      const entries = output?.entries
      if (Array.isArray(entries)) {
        const dirs = entries.filter((e: unknown) => typeof e === 'object' && e !== null && (e as Record<string,unknown>).type === 'directory').length
        const files = entries.filter((e: unknown) => typeof e === 'object' && e !== null && (e as Record<string,unknown>).type !== 'directory').length
        lines.push(`${tag} readdirSync 成功，条目数: ${entries.length}` + (dirs > 0 || files > 0 ? ` (${files} 文件, ${dirs} 目录)` : ''))
      } else {
        lines.push(`${tag} readdirSync 成功，条目数: ${entries?.length ?? '?'}`)
      }
      if (tc.isError) lines.push(`${tag} ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      break
    }
    case 'readFile': {
      const fp = String(input.file_path ?? '')
      lines.push(`${tag} 开始执行, raw input: { file_path: '${fp}' }`)
      lines.push(`${tag} 解析后 params: { file_path: '${fp}' }`)
      lines.push(`${tag} filePath: ${fp}`)
      lines.push(`[fs-tools] checkAccess: ${fp} → ${fp}`)
      lines.push(`[fs-tools] isApproved: true`)
      lines.push(`[fs-tools] ✓ 已授权，直接访问`)
      if (tc.isError) {
        lines.push(`${tag} ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      } else {
        const output = tc.output as string | undefined
        if (typeof output === 'string') {
          const lineCount = output.split('\n').length
          lines.push(`${tag} 读取成功，${lineCount} 行, ${output.length} 字符`)
        } else {
          lines.push(`${tag} 读取成功`)
        }
      }
      break
    }
    case 'glob': {
      const pat = String(input.pattern ?? '')
      const sp = String(input.path ?? '')
      lines.push(`${tag} 开始执行, raw input: { pattern: '${pat}'${sp ? `, path: '${sp}'` : ''} }`)
      lines.push(`${tag} walkFiles 完成...`)
      const output = tc.output as string[] | undefined
      if (Array.isArray(output)) {
        lines.push(`${tag} 匹配到 ${output.length} 个文件`)
      }
      if (tc.isError) lines.push(`${tag} ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      break
    }
    case 'grep': {
      const pat = String(input.pattern ?? '')
      const sp = String(input.search_path ?? input.path ?? '')
      lines.push(`${tag} 开始执行, raw input: { pattern: '${pat}'${sp ? `, search_path: '${sp}'` : ''} }`)
      const output = tc.output as unknown
      if (output && typeof output === 'object') {
        const arr = Array.isArray(output) ? output : [output]
        lines.push(`${tag} 搜索完成，找到 ${arr.length} 个匹配`)
      } else {
        lines.push(`${tag} 搜索完成`)
      }
      if (tc.isError) lines.push(`${tag} ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      break
    }
    case 'bash': {
      const cmd = String(input.command ?? '')
      const desc = input.description ? ` (${input.description})` : ''
      lines.push(`[cc-tools:bash] 开始执行${desc}`)
      lines.push(`[cc-tools:bash] command: ${cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd}`)
      if (tc.isError) {
        lines.push(`[cc-tools:bash] ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      } else {
        lines.push(`[cc-tools:bash] 执行完成`)
      }
      break
    }
    case 'write':
    case 'edit':
    case 'multiEdit': {
      const fp = extractFilePath(tc.input)
      if (fp) {
        lines.push(`[cc-tools:${tc.toolName}] filePath: ${fp}`)
        if (tc.isError) {
          lines.push(`[cc-tools:${tc.toolName}] ✗ 错误: ${tc.errorText ?? 'unknown'}`)
        } else {
          lines.push(`[cc-tools:${tc.toolName}] 写入成功`)
        }
      }
      break
    }
    default: {
      lines.push(`[tools:${tc.toolName}] 调用`)
      lines.push(`[tools:${tc.toolName}] input: ${fmtVal(tc.input, 160)}`)
      if (tc.isError) {
        lines.push(`[tools:${tc.toolName}] ✗ 错误: ${tc.errorText ?? 'unknown'}`)
      } else {
        lines.push(`[tools:${tc.toolName}] 完成`)
      }
    }
  }
  return lines
}

function ToolLogs({ conversation }: { conversation: ConversationData | null }) {
  type LogEntry = {
    toolCallId: string; toolName: string; line: string
    timestamp: string; isError: boolean
  }

  type RoundGroup = { msgId: string; roundIdx: number; timestamp: string; entries: LogEntry[]; usage?: { inputTokens?: number; outputTokens?: number } }

  // 按轮次分组
  const roundGroups = useMemo(() => {
    if (!conversation) return []
    const groups: RoundGroup[] = []
    let roundNum = 0
    for (const msg of conversation.messages) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue
      roundNum++
      const entries: LogEntry[] = []
      for (const tc of msg.toolCalls) {
        const lines = generateLogLines(tc)
        for (const line of lines) {
          entries.push({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            line,
            timestamp: msg.timestamp,
            isError: line.includes('✗'),
          })
        }
      }
      groups.push({ msgId: msg.id, roundIdx: roundNum, timestamp: msg.timestamp, entries, usage: msg.usage })
    }
    return groups
  }, [conversation])

  // 默认只展开最后一轮
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(() => {
    if (roundGroups.length === 0) return new Set()
    return new Set([roundGroups[roundGroups.length - 1].roundIdx])
  })

  // 当前轮次变化时自动展开
  useEffect(() => {
    if (roundGroups.length === 0) return
    const lastIdx = roundGroups[roundGroups.length - 1].roundIdx
    setExpandedRounds(prev => {
      if (prev.has(lastIdx)) return prev
      const next = new Set([lastIdx]) // 只保留最新轮展开
      return next
    })
  }, [roundGroups.length])

  const toggleRound = (roundIdx: number) => {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      if (next.has(roundIdx)) next.delete(roundIdx)
      else next.add(roundIdx)
      return next
    })
  }

  // 复制状态：记录刚复制过的轮次 ID
  const [copiedRound, setCopiedRound] = useState<number | null>(null)

  const handleCopyRound = async (round: RoundGroup) => {
    const header = `第 ${round.roundIdx} 轮 — ${formatRelativeTime(round.timestamp)}${round.usage ? ` (↑${fmtTokens(round.usage.inputTokens) || '0'} ↓${fmtTokens(round.usage.outputTokens) || '0'})` : ''}`
    const body = round.entries.map(e => e.line).join('\n')
    const text = `${header}\n${'─'.repeat(50)}\n${body}`
    await navigator.clipboard.writeText(text)
    setCopiedRound(round.roundIdx)
    setTimeout(() => setCopiedRound(null), 1500)
  }

  if (roundGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <ScrollText size={32} className="text-text-muted mb-3 opacity-50" />
        <p className="text-sm text-text-muted">暂无工具日志</p>
        <p className="text-xs text-text-muted mt-1">Agent 调用工具后，这里将显示详细日志</p>
      </div>
    )
  }

  const totalToolCalls = roundGroups.reduce((sum, g) => sum + new Set(g.entries.map(e => e.toolCallId)).size, 0)
  const totalLogs = roundGroups.reduce((sum, g) => sum + g.entries.length, 0)

  return (
    <div className="h-full overflow-y-auto">
      {/* 统计头 */}
      <div className="px-3 py-2 border-b border-border-subtle bg-background flex items-center gap-2 sticky top-0 z-10">
        <Clock size={12} className="text-text-muted" />
        <span className="text-xs text-text-muted">
          共 <span className="font-semibold text-text-secondary">{roundGroups.length}</span> 轮对话，
          <span className="font-semibold text-text-secondary"> {totalToolCalls}</span> 次工具调用，
          <span className="font-semibold text-text-secondary"> {totalLogs}</span> 条日志
        </span>
      </div>

      {/* 日志列表 */}
      <div className="font-mono text-[11px] leading-relaxed">
        {roundGroups.map((round) => {
          const isExpanded = expandedRounds.has(round.roundIdx)
          let lastTcId = ''
          return (
            <div key={round.msgId}>
              {/* 轮次分割头 — 可点击折叠 */}
              <button
                onClick={() => toggleRound(round.roundIdx)}
                className="flex items-center gap-2 px-3 py-1.5 border-b border-accent/20 w-full text-left hover:bg-accent/10 transition-colors cursor-pointer bg-background sticky top-8 z-[5]"
              >
                <ChevronDown
                  size={10}
                  className="text-accent flex-shrink-0 transition-transform"
                  style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <span className="text-[10px] font-semibold text-accent">
                  第 {round.roundIdx} 轮
                </span>
                <span className="text-[10px] text-text-muted">
                  {formatRelativeTime(round.timestamp)}
                </span>
                {round.usage && (round.usage.inputTokens || round.usage.outputTokens) ? (
                  <span className="text-[10px] text-text-muted/60">
                    ↑{fmtTokens(round.usage.inputTokens) || '0'} ↓{fmtTokens(round.usage.outputTokens) || '0'}
                  </span>
                ) : null}
                <span className="text-[10px] text-text-muted/50 ml-auto">
                  {new Set(round.entries.map(e => e.toolCallId)).size} 次调用
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyRound(round)
                  }}
                  title="复制本轮日志"
                  className="p-0.5 rounded hover:bg-surface/60 transition-colors text-text-muted/40 hover:text-text-muted flex-shrink-0"
                >
                  {copiedRound === round.roundIdx ? (
                    <ClipboardCheck size={12} className="text-status-ok" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </button>

              {/* 折叠内容 */}
              {isExpanded && round.entries.map((entry, idx) => {
                const isNewTool = entry.toolCallId !== lastTcId
                lastTcId = entry.toolCallId
                return (
                  <div key={`${entry.toolCallId}-${idx}`}>
                    {/* 工具调用头 */}
                    {isNewTool && (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-surface/20 border-b border-border-subtle/60">
                        {React.createElement(getToolIcon(entry.toolName), {
                          size: 11,
                          className: 'text-text-muted flex-shrink-0',
                        })}
                        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
                          {entry.toolName}
                        </span>
                      </div>
                    )}
                    {/* 日志行 */}
                    <div
                      className={`px-3 py-0.5 border-b border-border-subtle/30 whitespace-pre-wrap break-all flex gap-2 ${
                        entry.isError ? 'text-status-failed bg-status-failed/5' : 'text-text-muted'
                      }`}
                    >
                      <span className="text-text-muted/50 flex-shrink-0 select-none">{formatLogTime(entry.timestamp)}</span>
                      <span>{entry.line}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 变更文件面板 ──────────────────────────────────────────────────────────────

function ChangedFiles({ conversation }: { conversation: ConversationData | null }) {
  // 从修改内容中提取唯一文件列表
  const fileSet = new Map<string, { changeType: FileChange['changeType']; timestamp: string }>()

  if (conversation) {
    for (const msg of conversation.messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const filePath = extractFilePath(tc.input)
          if (filePath && (tc.toolName === 'write' || tc.toolName === 'edit' || tc.toolName === 'multiEdit')) {
            if (!fileSet.has(filePath) || new Date(msg.timestamp) > new Date(fileSet.get(filePath)!.timestamp)) {
              fileSet.set(filePath, {
                changeType: tc.output ? 'edit' : 'create',
                timestamp: msg.timestamp,
              })
            }
          }
        }
      }
    }
  }

  const files = Array.from(fileSet.entries()).map(([path, info]) => ({
    path,
    ...info,
  }))

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <FileText size={32} className="text-text-muted mb-3 opacity-50" />
        <p className="text-sm text-text-muted">暂无变更文件</p>
        <p className="text-xs text-text-muted mt-1">Agent 创建或编辑的文件将显示在这里</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 文件统计 */}
      <div className="px-4 py-2 border-b border-border-subtle bg-surface/50">
        <div className="flex items-center gap-4">
          <span className="text-xs text-text-muted">
            共 <span className="font-semibold text-text-secondary">{files.length}</span> 个文件
          </span>
          <span className="text-xs text-text-muted">
            <span className="text-status-done">{files.filter(f => f.changeType === 'create').length}</span> 创建
          </span>
          <span className="text-xs text-text-muted">
            <span className="text-accent">{files.filter(f => f.changeType === 'edit').length}</span> 编辑
          </span>
        </div>
      </div>

      {/* 文件列表 */}
      {files.map((file, idx) => (
        <div
          key={file.path}
          className={`px-4 py-2.5 border-b border-border-subtle ${
            idx === 0 ? 'border-t border-border' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`text-[10px] w-2 h-2 rounded-full flex-shrink-0 ${
              file.changeType === 'create' ? 'bg-status-done' : 'bg-accent'
            }`} />
            <span className="text-xs font-medium text-text-primary truncate flex-1">
              {file.path.split('/').pop()}
            </span>
            <span className="text-[10px] text-text-muted">
              {formatRelativeTime(file.timestamp)}
            </span>
          </div>
          <p className="text-[11px] text-text-muted font-mono truncate mt-0.5" title={file.path}>
            {file.path}
          </p>
        </div>
      ))}
    </div>
  )
};

// ─── 导出文档链接触发器组件 ─────────────────────────────────────────────────────

/** 可点击打开侧边栏的链接组件 */
interface OpenSidebarLinkProps {
  onClick: () => void
  children: React.ReactNode
}

export function OpenSidebarLink({ onClick, children }: OpenSidebarLinkProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-accent hover:underline text-xs"
      title="点击查看会话详情"
    >
      {children}
    </button>
  )
}
