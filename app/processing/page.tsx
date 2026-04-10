/*  start: 处理中心 — 接真实 API，支持读取 Agent 输出文件内容 + 工作流步骤日志时间线 */
'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'
type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'
type WorkflowStepType = 'agent' | 'human_in_loop' | 'parallel' | 'conditional' | 'loop'
type WfExecStatus = 'running' | 'waiting' | 'done' | 'failed'

// AI: 工作流步骤定义
interface WorkflowStepDef {
  id: string
  type: WorkflowStepType
  name: string
  agentName?: string
  actions?: Record<string, string>
  branches?: WorkflowStepDef[]
}

// AI: 步骤执行日志
interface StepLog {
  stepId: string
  stepName: string
  status: StepStatus
  agentName?: string
  startedAt?: string
  completedAt?: string
  error?: string
  actions?: Record<string, string>
}

// AI: 工作流执行实例
interface WorkflowExecution {
  taskId: string
  workflowId: string
  status: WfExecStatus
  currentStepId?: string
  steps: StepLog[]
  context: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// AI: 工作流定义
interface WorkflowDef {
  id: string
  name: string
  description?: string
  steps: WorkflowStepDef[]
}

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
  // AI: 多文件 tab 切换
  const [outputFiles, setOutputFiles] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [outputLoading, setOutputLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'inbox' | 'all'>('all')
  const [note, setNote] = useState('')
  const [score, setScore] = useState(8)
  const [actionLoading, setActionLoading] = useState(false)
  // AI: 工作流执行实例 + 定义（点击工作流任务时加载）
  const [wfExec, setWfExec] = useState<WorkflowExecution | null>(null)
  const [wfDef, setWfDef] = useState<WorkflowDef | null>(null)
  const [wfActionLoading, setWfActionLoading] = useState(false)
  // AI: 用 ref 标记 URL taskId 是否已完成初始选中（避免每次 fetchTasks 重复触发）
  const initSelectedRef = useRef(false)

  useEffect(() => {
    fetchTasks()
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      const all: Task[] = data.tasks ?? []
      setTasks(all)

      // AI: 若 URL 携带 taskId 且尚未完成初始选中，自动选中该任务
      if (initTaskId && !initSelectedRef.current) {
        const t = all.find((t) => t.id === initTaskId)
        if (t) {
          initSelectedRef.current = true
          setSelected(t)
          if (t.mode === 'workflow') {
            loadWfExecution(t.id)
          } else {
            loadOutput(t)
          }
        }
      }
    } catch {
      console.error('获取任务列表失败')
    }
  }

  async function loadOutput(task: Task) {
    if (!task.outputDir) {
      setOutputContent(null)
      setOutputFiles([])
      setActiveFile(null)
      return
    }
    setOutputLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/output`)
      if (res.ok) {
        const data = await res.json()
        setOutputContent(data.content ?? null)
        // AI: 保存多文件列表和当前激活文件
        setOutputFiles(data.files ?? [])
        setActiveFile(data.file ?? null)
      } else {
        setOutputContent(null)
        setOutputFiles([])
        setActiveFile(null)
      }
    } catch {
      setOutputContent(null)
      setOutputFiles([])
      setActiveFile(null)
    } finally {
      setOutputLoading(false)
    }
  }

  // AI: 切换输出文件 tab
  async function loadOutputFile(task: Task, fileName: string) {
    setOutputLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/output?file=${encodeURIComponent(fileName)}`)
      if (res.ok) {
        const data = await res.json()
        setOutputContent(data.content ?? null)
        setActiveFile(fileName)
      }
    } catch { /* ignore */ } finally {
      setOutputLoading(false)
    }
  }

  // AI: 加载工作流执行详情（工作流任务专用）
  async function loadWfExecution(taskId: string) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`)
      if (!res.ok) return
      const data = await res.json()
      setWfExec(data.workflowExecution ?? null)
      setWfDef(data.workflow ?? null)
    } catch {
      setWfExec(null)
      setWfDef(null)
    }
  }

  function selectTask(task: Task) {
    setSelected(task)
    setNote('')
    setWfExec(null)
    setWfDef(null)
    if (task.mode === 'workflow') {
      loadWfExecution(task.id)
    } else {
      loadOutput(task)
    }
  }

  // AI: 工作流 human_in_loop 操作
  async function handleWfAction(actionKey: string) {
    if (!selected) return
    setWfActionLoading(true)
    try {
      const res = await fetch(`/api/workflows/${selected.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionKey }),
      })
      if (res.ok) {
        const data = await res.json()
        setWfExec(data.execution)
      }
    } finally {
      setWfActionLoading(false)
    }
  }

  // AI: 调用 /run API 真正触发 Runner 执行（inbox/failed 任务）
  async function handleRun() {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tasks/${selected.id}/run`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setSelected(data.task)
        await fetchTasks()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? '执行失败')
      }
    } finally {
      setActionLoading(false)
    }
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

  // AI: 保存任务评分
  async function handleSaveScore() {
    if (!selected) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tasks/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      })
      if (res.ok) {
        const data = await res.json()
        setSelected(data.task)
      }
    } finally {
      setActionLoading(false)
    }
  }

  // AI: 删除任务
  async function handleDeleteTask() {
    if (!selected) return
    if (!confirm(`确认删除任务「${selected.title}」？此操作不可撤销。`)) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/tasks/${selected.id}`, { method: 'DELETE' })
      if (res.ok) {
        setSelected(null)
        setOutputContent(null)
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
              {/* AI: 删除任务按钮 */}
              <button
                onClick={handleDeleteTask}
                disabled={actionLoading}
                title="删除任务"
                className="flex-shrink-0 px-2 py-1 text-xs border border-status-failed/30 text-status-failed rounded hover:bg-status-failed/5 transition-colors disabled:opacity-40"
              >
                删除
              </button>
            </div>

            {/* AI: 工作流任务显示步骤时间线，轻量任务显示输出内容 */}
            <div className="flex-1 overflow-auto p-6">
              {selected.mode === 'workflow' ? (
                <WorkflowTimeline
                  exec={wfExec}
                  def={wfDef}
                  onAction={handleWfAction}
                  actionLoading={wfActionLoading}
                />
              ) : outputLoading ? (
                <div className="text-sm text-text-muted">读取输出文件...</div>
              ) : selected.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs font-medium text-red-600 mb-1 uppercase tracking-wider">错误信息</p>
                  <pre className="text-sm text-red-700 font-mono whitespace-pre-wrap">{selected.error}</pre>
                </div>
              ) : outputContent ? (
                <div>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Agent 输出</p>
                    {/* AI: 多文件 tab 切换 */}
                    {outputFiles.length > 1 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {outputFiles.map((f) => (
                          <button
                            key={f}
                            onClick={() => loadOutputFile(selected, f)}
                            className={`text-xs px-2 py-0.5 rounded border font-mono transition-colors ${
                              f === activeFile
                                ? 'bg-accent text-text-inverse border-accent'
                                : 'bg-surface text-text-secondary border-border hover:border-accent hover:text-text-primary'
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    )}
                    {outputFiles.length === 1 && activeFile && (
                      <span className="text-xs text-text-muted font-mono">{activeFile}</span>
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
                  onRun={handleRun}
                  loading={actionLoading}
                />
              )}
              {selected.status === 'done' && (
                <ScorePanel score={score} onScore={setScore} onSave={handleSaveScore} saving={actionLoading} />
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
  onRun,
  loading,
}: {
  task: Task
  note: string
  onNoteChange: (v: string) => void
  onStatusChange: (s: TaskStatus) => void
  onRun: () => void
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
          // AI: 点击「开始执行」调用 /run API 触发 Runner 真实执行
          <button
            onClick={onRun}
            disabled={loading}
            className="flex-1 py-2 text-sm font-medium bg-status-running text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            ▶ 开始执行
          </button>
        )}
        {task.status === 'failed' && (
          // AI: 失败任务重新调度执行
          <button
            onClick={onRun}
            disabled={loading}
            className="flex-1 py-2 text-sm font-medium bg-status-pending text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            ↺ 重新执行
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
  onSave,
  saving,
}: {
  score: number
  onScore: (s: number) => void
  onSave: () => void
  saving: boolean
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
        <button
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {saving ? '保存中...' : '保存评分'}
        </button>
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
// AI: 工作流步骤时间线组件（含 StepLogViewer 实时日志）

// AI: 步骤实时日志查看器 — 轮询 /api/tasks/{taskId}/steps/{stepId}/log 展示日志
function StepLogViewer({ taskId, stepId, active }: { taskId: string; stepId: string; active: boolean }) {
  const [log, setLog] = useState('')
  const [offset, setOffset] = useState(0)
  const [done, setDone] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!active && done) return

    async function fetchLog() {
      try {
        const res = await fetch(`/api/tasks/${taskId}/steps/${stepId}/log?offset=${offset}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.content) {
          setLog((prev) => prev + data.content)
          setOffset(data.offset)
          // AI: 自动滚动到底部
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight
          }
        }
        if (data.done) setDone(true)
      } catch { /* ignore */ }
    }

    fetchLog()
    if (done) return
    const timer = setInterval(fetchLog, 1500)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, stepId, active, done])

  if (!log && !active) return null
  if (!log) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
        <div className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse" />
        <span>等待日志输出...</span>
      </div>
    )
  }

  return (
    <pre
      ref={logRef}
      className="mt-2 text-xs font-mono text-text-secondary bg-surface border border-border-subtle rounded-md p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed"
    >
      {log}
    </pre>
  )
}

// AI: 步骤状态视觉配置
const STEP_STYLE: Record<StepStatus, { icon: string; textCls: string; lineCls: string }> = {
  pending:  { icon: '○', textCls: 'text-text-muted',       lineCls: 'border-border-subtle' },
  running:  { icon: '◉', textCls: 'text-status-running',   lineCls: 'border-status-running' },
  waiting:  { icon: '◈', textCls: 'text-yellow-500',       lineCls: 'border-yellow-300' },
  done:     { icon: '✓', textCls: 'text-status-done',      lineCls: 'border-status-done' },
  failed:   { icon: '✗', textCls: 'text-status-failed',    lineCls: 'border-status-failed' },
  skipped:  { icon: '—', textCls: 'text-text-muted',       lineCls: 'border-border-subtle' },
}

const STEP_TYPE_LABEL: Record<WorkflowStepType, string> = {
  agent:        'Agent',
  human_in_loop:'Human',
  parallel:     'Parallel',
  conditional:  'Cond',
  loop:         'Loop',
}

function fmtDuration(start?: string, end?: string): string {
  if (!start) return ''
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const ms = e - s
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`
}

function WorkflowTimeline({
  exec,
  def,
  onAction,
  actionLoading,
}: {
  exec: WorkflowExecution | null
  def: WorkflowDef | null
  onAction: (actionKey: string) => void
  actionLoading: boolean
}) {
  if (!exec && !def) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-sm text-text-muted">工作流执行记录加载中...</p>
      </div>
    )
  }

  if (!exec) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <p className="text-sm text-text-muted">工作流尚未开始执行</p>
        <p className="text-xs text-text-muted mt-1">任务创建后将自动调度工作流</p>
      </div>
    )
  }

  const steps = def?.steps ?? []

  return (
    <div className="max-w-2xl">
      {/* 整体状态头 */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
        <div className={`text-xs px-2 py-1 rounded-full font-medium border ${
          exec.status === 'running' ? 'bg-blue-50 text-blue-600 border-blue-200' :
          exec.status === 'waiting' ? 'bg-yellow-50 text-yellow-600 border-yellow-200' :
          exec.status === 'done'    ? 'bg-green-50 text-green-600 border-green-200' :
                                      'bg-red-50 text-red-600 border-red-200'
        }`}>
          {exec.status === 'running' ? '执行中' :
           exec.status === 'waiting' ? '⚠ 等待操作' :
           exec.status === 'done'    ? '✓ 已完成' : '✗ 失败'}
        </div>
        {def && <span className="text-sm text-text-secondary">{def.name}</span>}
        <span className="text-xs text-text-muted ml-auto">
          {new Date(exec.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* 步骤时间线 */}
      <div className="relative">
        {steps.map((step, idx) => {
          const log = exec.steps.find((s) => s.stepId === step.id)
          const status: StepStatus = log?.status ?? 'pending'
          const style = STEP_STYLE[status]
          const isLast = idx === steps.length - 1
          const isCurrentWaiting = exec.status === 'waiting' && exec.currentStepId === step.id

          return (
            <div key={step.id} className="flex gap-4">
              {/* AI: 垂直连接线 + 图标 */}
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-medium ${
                  status === 'done'    ? 'bg-status-done/10 border-status-done text-status-done' :
                  status === 'running' ? 'bg-status-running/10 border-status-running text-status-running animate-pulse' :
                  status === 'waiting' ? 'bg-yellow-50 border-yellow-400 text-yellow-500' :
                  status === 'failed'  ? 'bg-red-50 border-status-failed text-status-failed' :
                  'bg-background border-border text-text-muted'
                }`}>
                  {style.icon}
                </div>
                {!isLast && <div className={`w-px flex-1 min-h-4 border-l-2 my-1 ${style.lineCls}`} />}
              </div>

              {/* 步骤内容 */}
              <div className="flex-1 pb-5 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary">{step.name}</span>
                  <span className="text-xs text-text-muted bg-surface border border-border-subtle px-1.5 py-0.5 rounded">
                    {STEP_TYPE_LABEL[step.type]}
                  </span>
                  {step.agentName && (
                    <span className="text-xs text-text-muted font-mono">{step.agentName}</span>
                  )}
                  {log?.startedAt && (
                    <span className="text-xs text-text-muted ml-auto">
                      {fmtDuration(log.startedAt, log.completedAt)}
                    </span>
                  )}
                </div>

                {/* AI: 错误详情 */}
                {log?.error && (
                  <div className="mt-2 text-xs text-status-failed bg-red-50 rounded p-2 break-all">
                    {log.error}
                  </div>
                )}

                {/* AI: parallel 子分支展示 */}
                {step.type === 'parallel' && step.branches && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {step.branches.map((branch) => {
                      const branchLog = exec.steps.find((s) => s.stepId === branch.id)
                      const bStatus = branchLog?.status ?? 'pending'
                      const bStyle = STEP_STYLE[bStatus]
                      return (
                        <div
                          key={branch.id}
                          className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border-subtle rounded text-xs"
                        >
                          <span className={bStyle.textCls}>{bStyle.icon}</span>
                          <span className="text-text-secondary">{branch.name}</span>
                          {branch.agentName && (
                            <span className="text-text-muted font-mono">({branch.agentName})</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* AI: agent 步骤实时日志（running 时轮询显示，完成后保留） */}
                {step.type === 'agent' && (status === 'running' || status === 'done' || status === 'failed') && (
                  <StepLogViewer
                    taskId={exec.taskId}
                    stepId={step.id}
                    active={status === 'running'}
                  />
                )}

                {/* AI: human_in_loop 等待操作按钮（当前步骤 waiting 时才显示）*/}
                {isCurrentWaiting && step.type === 'human_in_loop' && log?.actions && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {Object.entries(log.actions).map(([key, targetStep]) => (
                      <button
                        key={key}
                        onClick={() => onAction(key)}
                        disabled={actionLoading}
                        className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                          key === 'approve' || key === 'score'
                            ? 'bg-accent text-text-inverse hover:bg-accent-hover'
                            : key === 'reject'
                            ? 'bg-red-50 text-status-failed border border-status-failed/30 hover:bg-red-100'
                            : 'bg-surface text-text-secondary border border-border hover:bg-accent-subtle'
                        } disabled:opacity-50`}
                      >
                        {actionLoading ? '处理中...' : (
                          key === 'approve' ? '✓ 批准'
                          : key === 'reject'  ? '✗ 拒绝'
                          : key === 'score'   ? '★ 打分'
                          : key
                        )}
                        <span className="ml-1 text-xs opacity-60 font-mono">→ {targetStep}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/*  end: 处理中心结束 */
