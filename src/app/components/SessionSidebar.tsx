/* 工作区侧边栏 — 展示文件、变更、Session、会话日志 */
'use client'

import React, { useState, useEffect, useRef, memo } from 'react'
import { FileEdit, FileText, ScrollText, MonitorDot, Brain } from 'lucide-react'
import SystemLogs from './SystemLogs'
import { ContextView } from './ContextView'

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
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number }
  stepUsages?: Array<{ inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number; toolNames?: string[] }>
}

/** 任务数据 */
export interface TaskData {
  id: string
  title: string
  agentName: string
  messages: StoredMessage[]
  context?: Record<string, unknown>
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
type TabId = 'files' | 'changes' | 'session' | 'context' | 'logs'

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



function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
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
  /** 任务数据 */
  task: TaskData | null
}

export const SessionSidebar = memo(function SessionSidebar({
  open,
  task,
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
            { id: 'files' as TabId, label: '文件', icon: FileText },
            { id: 'changes' as TabId, label: '变更', icon: FileEdit },
            { id: 'session' as TabId, label: 'Session', icon: MonitorDot },
            { id: 'context' as TabId, label: '上下文', icon: Brain },
            { id: 'logs' as TabId, label: '日志', icon: ScrollText },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                activeTab === id
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'files' && (
            <ChangedFiles task={task} />
          )}
          {activeTab === 'changes' && (
            <FileChanges task={task} />
          )}
          {activeTab === 'session' && (
            <SessionInfo task={task} />
          )}
          {activeTab === 'context' && (
            <ContextView taskId={task?.id} />
          )}
          {activeTab === 'logs' && (
            <SystemLogs taskId={task?.id} />
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

function FileChanges({ task }: { task: TaskData | null }) {
  // 从工具调用中提取修改内容
  const changes: FileChange[] = []

  if (task) {
    for (const msg of task.messages) {
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

// ─── Session 面板 ──────────────────────────────────────────────────────────────

function SessionInfo({ task }: { task: TaskData | null }) {
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <MonitorDot size={32} className="text-text-muted mb-3 opacity-50" />
        <p className="text-sm text-text-muted">暂无任务信息</p>
        <p className="text-xs text-text-muted mt-1">开始对话后将显示 Session 详情</p>
      </div>
    )
  }

  // 统计信息
  const userMessages = task.messages.filter(m => m.role === 'user')
  const assistantMessages = task.messages.filter(m => m.role === 'assistant')
  const allToolCalls = assistantMessages.flatMap(m => m.toolCalls ?? [])
  const fileOps = allToolCalls.filter(tc =>
    tc.toolName === 'write' || tc.toolName === 'edit' || tc.toolName === 'multiEdit'
  )
  const errorOps = allToolCalls.filter(tc => tc.isError)

  // Token 统计
  let totalInput = 0, totalOutput = 0
  for (const msg of assistantMessages) {
    if (msg.usage) {
      totalInput += msg.usage.inputTokens ?? 0
      totalOutput += msg.usage.outputTokens ?? 0
    }
  }

  // 工具使用统计
  const toolUsageMap = new Map<string, number>()
  for (const tc of allToolCalls) {
    toolUsageMap.set(tc.toolName, (toolUsageMap.get(tc.toolName) ?? 0) + 1)
  }
  const toolUsageList = Array.from(toolUsageMap.entries())
    .sort((a, b) => b[1] - a[1])

  function formatTime(ts: string): string {
    try { return new Date(ts).toLocaleString('zh-CN') } catch { return ts }
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 任务基本信息 */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary mb-2">任务信息</h3>
        <div className="space-y-1.5">
          <InfoRow label="ID" value={task.id.slice(0, 8) + '…'} mono />
          <InfoRow label="标题" value={task.title} />
          <InfoRow label="Agent" value={task.agentName || '—'} />
          <InfoRow label="创建时间" value={formatTime(task.createdAt)} />
          <InfoRow label="更新时间" value={formatTime(task.updatedAt)} />
        </div>
      </div>

      {/* 消息统计 */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary mb-2">消息统计</h3>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="用户消息" value={userMessages.length} />
          <StatCard label="助手消息" value={assistantMessages.length} />
          <StatCard label="工具调用" value={allToolCalls.length} />
          <StatCard label="文件操作" value={fileOps.length} />
          <StatCard label="错误" value={errorOps.length} accent={errorOps.length > 0} />
          <StatCard label="总消息" value={task.messages.length} />
        </div>
      </div>

      {/* Token 用量 */}
      {(totalInput > 0 || totalOutput > 0) && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Token 用量</h3>
          <div className="space-y-1.5">
            <InfoRow label="输入" value={totalInput.toLocaleString()} mono />
            <InfoRow label="输出" value={totalOutput.toLocaleString()} mono />
            <InfoRow label="合计" value={(totalInput + totalOutput).toLocaleString()} mono />
          </div>
        </div>
      )}

      {/* 工具使用分布 */}
      {toolUsageList.length > 0 && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2">工具使用</h3>
          <div className="space-y-1">
            {toolUsageList.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between">
                <span className="text-xs font-mono text-text-secondary">{name}</span>
                <span className="text-xs text-text-muted">{count} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 上下文 */}
      {task.context && Object.keys(task.context).length > 0 && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2">上下文</h3>
          <pre className="text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {JSON.stringify(task.context, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-text-muted flex-shrink-0">{label}</span>
      <span className={`text-xs text-text-secondary truncate text-right ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-surface/50 border border-border-subtle text-center">
      <div className={`text-sm font-semibold ${accent ? 'text-status-failed' : 'text-text-primary'}`}>{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}









// ─── 变更文件面板 ──────────────────────────────────────────────────────────────

function ChangedFiles({ task }: { task: TaskData | null }) {
  // 从修改内容中提取唯一文件列表
  const fileSet = new Map<string, { changeType: FileChange['changeType']; timestamp: string }>()

  if (task) {
    for (const msg of task.messages) {
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
      title="点击查看工作区"
    >
      {children}
    </button>
  )
}
