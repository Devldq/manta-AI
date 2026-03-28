/*  start: 处理中心 — 接真实 API，支持读取 Agent 输出文件内容 */
'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  mode: 'lightweight' | 'workflow'
  agentName?: string
  workflowId?: string
  outputDir?: string
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

// AI: 需要人工介入的状态
const NEEDS_ACTION_STATUSES: TaskStatus[] = ['inbox', 'failed']

export default function ProcessingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-text-muted">加载中...</div>}>
      <ProcessingPageInner />
    </Suspense>
  )
}

function ProcessingPageInner() {
  const searchParams = useSearchParams()
  const initTaskId = searchParams.get('taskId')

  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [outputContent, setOutputContent] = useState<string | null>(null)
  const [outputLoading, setOutputLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'inbox' | 'all'>('all')
  const [note, setNote] = useState('')
  const [score, setScore] = useState(8)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    fetchTasks()
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      const all: Task[] = data.tasks ?? []
      setTasks(all)

      // AI: 若 URL 携带 taskId，自动选中该任务
      if (initTaskId && !selected) {
        const t = all.find((t) => t.id === initTaskId)
        if (t) {
          setSelected(t)
          loadOutput(t)
        }
      }
    } catch {
      console.error('获取任务列表失败')
    }
  }

  async function loadOutput(task: Task) {
    if (!task.outputDir) {
      setOutputContent(null)
      return
    }
    setOutputLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/output`)
      if (res.ok) {
        const data = await res.json()
        setOutputContent(data.content ?? null)
      } else {
        setOutputContent(null)
      }
    } catch {
      setOutputContent(null)
    } finally {
      setOutputLoading(false)
    }
  }

  function selectTask(task: Task) {
    setSelected(task)
    setNote('')
    loadOutput(task)
  }

  async function handleStatusChange(newStatus: TaskStatus) {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tasks/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data.task)
        await fetchTasks()
      }
    } finally {
      setActionLoading(false)
    }
  }

  const displayTasks = viewMode === 'inbox'
    ? tasks.filter((t) => NEEDS_ACTION_STATUSES.includes(t.status))
    : tasks

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 Header */}
      <div
        style={{ height: 'var(--header-height)' }}
        className="flex items-center justify-between px-6 border-b border-border flex-shrink-0"
      >
        <div>
          <h1 className="text-base font-semibold text-text-primary">处理中心</h1>
          <p className="text-xs text-text-muted">
            {tasks.filter((t) => NEEDS_ACTION_STATUSES.includes(t.status)).length} 项需要关注
          </p>
        </div>
        {/* 视图切换 */}
        <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-0.5">
          <button
            onClick={() => setViewMode('inbox')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              viewMode === 'inbox'
                ? 'bg-background text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            待处理
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              viewMode === 'all'
                ? 'bg-background text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            全部
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧任务列表 */}
        <div className="w-72 border-r border-border flex flex-col flex-shrink-0">
          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {displayTasks.length === 0 && (
              <div className="flex items-center justify-center h-32">
                <p className="text-sm text-text-muted">暂无任务</p>
              </div>
            )}
            {displayTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => selectTask(task)}
                className={`w-full text-left p-4 hover:bg-surface transition-colors ${
                  selected?.id === task.id ? 'bg-accent-subtle border-l-2 border-l-accent' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{task.title}</p>
                    {task.agentName && (
                      <p className="text-xs text-text-muted mt-0.5 font-mono">{task.agentName}</p>
                    )}
                  </div>
                  <StatusDot status={task.status} />
                </div>
                <p className="text-xs text-text-muted mt-1.5">{formatRelative(task.updatedAt)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 右侧：详情 + 决策面板 */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 任务标题栏 */}
            <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-text-primary">{selected.title}</h2>
                {selected.description && (
                  <p className="text-sm text-text-muted mt-1">{selected.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <StatusBadge status={selected.status} />
                  {selected.agentName && (
                    <span className="text-xs text-text-muted font-mono">
                      Agent: {selected.agentName}
                    </span>
                  )}
                  {selected.mode && (
                    <span className="text-xs text-text-muted">
                      {selected.mode === 'lightweight' ? '轻量模式' : '工作流模式'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 输出内容查看器 */}
            <div className="flex-1 overflow-auto p-6">
              {outputLoading ? (
                <div className="text-sm text-text-muted">读取输出文件...</div>
              ) : selected.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs font-medium text-red-600 mb-1 uppercase tracking-wider">错误信息</p>
                  <pre className="text-sm text-red-700 font-mono whitespace-pre-wrap">{selected.error}</pre>
                </div>
              ) : outputContent ? (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Agent 输出</p>
                    {selected.outputDir && (
                      <span className="text-xs text-text-muted font-mono truncate">{selected.outputDir}</span>
                    )}
                  </div>
                  <pre className="text-sm text-text-primary font-mono whitespace-pre-wrap leading-relaxed bg-surface rounded-lg p-5 border border-border-subtle overflow-x-auto">
                    {outputContent}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <p className="text-sm text-text-muted">
                    {selected.status === 'running'
                      ? 'Agent 正在执行中...'
                      : selected.status === 'inbox'
                      ? '任务尚未开始执行'
                      : '暂无输出内容'}
                  </p>
                  {selected.status === 'running' && (
                    <div className="mt-3 flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-status-running animate-bounce"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 决策面板 */}
            <div className="border-t border-border p-5 bg-surface flex-shrink-0">
              {(selected.status === 'inbox' || selected.status === 'failed') && (
                <QuickActionPanel
                  task={selected}
                  note={note}
                  onNoteChange={setNote}
                  onStatusChange={handleStatusChange}
                  loading={actionLoading}
                />
              )}
              {selected.status === 'done' && (
                <ScorePanel score={score} onScore={setScore} />
              )}
              {selected.status === 'running' && (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  <div className="w-2 h-2 rounded-full bg-status-running animate-pulse" />
                  <span>Agent 正在执行，完成后将自动更新状态</span>
                </div>
              )}
              {selected.status === 'archived' && (
                <div className="text-sm text-text-muted">此任务已归档</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-text-muted">← 从左侧选择一个任务</p>
          </div>
        )}
      </div>
    </div>
  )
}

// AI: 状态点
function StatusDot({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    inbox:    'var(--color-status-pending)',
    planning: 'var(--color-status-planning)',
    running:  'var(--color-status-running)',
    done:     'var(--color-status-done)',
    failed:   'var(--color-status-failed)',
    archived: 'var(--color-status-archived)',
  }
  return (
    <div
      className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
      style={{ backgroundColor: colors[status] }}
    />
  )
}

// AI: 状态 Badge
const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox:    '待处理',
  planning: '规划中',
  running:  '进行中',
  done:     '已完成',
  failed:   '失败',
  archived: '已归档',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    inbox:    'var(--color-status-pending)',
    planning: 'var(--color-status-planning)',
    running:  'var(--color-status-running)',
    done:     'var(--color-status-done)',
    failed:   'var(--color-status-failed)',
    archived: 'var(--color-status-archived)',
  }
  const color = colors[status]
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${color}18`, color }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// AI: 快捷操作面板（inbox/failed 任务）
function QuickActionPanel({
  task,
  note,
  onNoteChange,
  onStatusChange,
  loading,
}: {
  task: Task
  note: string
  onNoteChange: (v: string) => void
  onStatusChange: (s: TaskStatus) => void
  loading: boolean
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">快速操作</p>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="添加备注（可选）..."
        rows={2}
        className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
      />
      <div className="flex items-center gap-2">
        {task.status === 'inbox' && (
          <button
            onClick={() => onStatusChange('running')}
            disabled={loading}
            className="flex-1 py-2 text-sm font-medium bg-status-running text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            ▶ 开始执行
          </button>
        )}
        {task.status === 'failed' && (
          <button
            onClick={() => onStatusChange('inbox')}
            disabled={loading}
            className="flex-1 py-2 text-sm font-medium bg-status-pending text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            ↺ 重新入队
          </button>
        )}
        <button
          onClick={() => onStatusChange('archived')}
          disabled={loading}
          className="px-4 py-2 text-sm text-text-muted border border-border rounded-md hover:bg-surface transition-colors disabled:opacity-50"
        >
          归档
        </button>
      </div>
    </div>
  )
}

// AI: 打分面板（done 任务）
function ScorePanel({
  score,
  onScore,
}: {
  score: number
  onScore: (s: number) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">任务评分</p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          value={score}
          onChange={(e) => onScore(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-2xl font-semibold text-text-primary w-8 text-right">{score}</span>
        <span className="text-sm text-text-muted">/ 10</span>
      </div>
    </div>
  )
}

// AI: 相对时间格式化
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}m 前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h 前`
  return `${Math.floor(hours / 24)}d 前`
}
/*  end: 处理中心结束 */
