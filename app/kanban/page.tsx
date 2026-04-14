/*  start: Manta 任务看板页 — 接通真实后端 API，点击任务卡片侧拉打开处理中心 */
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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

// AI: 工作流执行进度摘要（来自 API 附加字段 _wfProgress）
interface WfProgress {
  execStatus: 'running' | 'waiting' | 'done' | 'failed'
  currentStepName: string | null
  currentStepType: string | null
  stepsDot: string[]
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
  _wfProgress?: WfProgress
}

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'inbox',    label: '待处理', color: 'var(--color-status-pending)' },
  { id: 'planning', label: '规划中', color: 'var(--color-status-planning)' },
  { id: 'running',  label: '进行中', color: 'var(--color-status-running)' },
  { id: 'done',     label: '已完成', color: 'var(--color-status-done)' },
  { id: 'failed',   label: '失败',   color: 'var(--color-status-failed)' },
  { id: 'archived', label: '已归档', color: 'var(--color-status-archived)' },
]

// AI: 需要人工介入的状态
const NEEDS_ACTION_STATUSES: TaskStatus[] = ['inbox', 'failed']

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)
  // AI: 侧拉处理中心状态
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      setTasks(data.tasks ?? [])
    } catch {
      console.error('获取任务失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
    // AI: 每 5 秒轮询一次，更新进行中任务的状态
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status)

  // AI: 点击任务卡片打开侧拉处理中心
  function openDrawer(taskId: string) {
    setDrawerTaskId(taskId)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setDrawerTaskId(null)
    fetchTasks()
  }

  return (
    <div className="flex flex-col h-full">
      <div
        style={{ height: 'var(--header-height)' }}
        className="flex items-center justify-between px-6 border-b border-border flex-shrink-0"
      >
        <div>
          <h1 className="text-base font-semibold text-text-primary">任务看板</h1>
          <p className="text-xs text-text-muted">
            {loading ? '加载中...' : `${tasks.length} 个任务`}
          </p>
        </div>
        <button
          onClick={() => setShowNewTask(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent text-text-inverse text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <span>+</span>
          <span>新建任务</span>
        </button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 h-full p-5" style={{ minWidth: 'max-content' }}>
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={getTasksByStatus(col.id)}
              onRefresh={fetchTasks}
              onOpenDrawer={openDrawer}
            />
          ))}
        </div>
      </div>

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onSuccess={() => { setShowNewTask(false); fetchTasks() }}
        />
      )}

      {/* AI: 侧拉处理中心 */}
      <ProcessingDrawer
        open={drawerOpen}
        taskId={drawerTaskId}
        onClose={closeDrawer}
      />
    </div>
  )
}

function KanbanColumn({
  column,
  tasks,
  onRefresh,
  onOpenDrawer,
}: {
  column: { id: TaskStatus; label: string; color: string }
  tasks: Task[]
  onRefresh: () => void
  onOpenDrawer: (taskId: string) => void
}) {
  return (
    <div className="flex flex-col w-64 flex-shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: column.color }} />
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          {column.label}
        </span>
        <span className="ml-auto text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-32">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onRefresh={onRefresh} onOpenDrawer={onOpenDrawer} />
        ))}
        {tasks.length === 0 && (
          <div className="h-20 border border-dashed border-border-subtle rounded-md flex items-center justify-center">
            <span className="text-xs text-text-muted">暂无任务</span>
          </div>
        )}
      </div>
    </div>
  )
}

// AI: 步骤状态圆点颜色映射
const DOT_COLOR: Record<string, string> = {
  pending:  'bg-border',
  running:  'bg-status-running animate-pulse',
  waiting:  'bg-yellow-400 animate-pulse',
  done:     'bg-status-done',
  failed:   'bg-status-failed',
  skipped:  'bg-border opacity-40',
}

/* AI start: TaskCard — 支持快捷操作菜单（归档/删除）+ 点击打开侧拉处理中心 */
function TaskCard({
  task,
  onRefresh,
  onOpenDrawer,
}: {
  task: Task
  onRefresh: () => void
  onOpenDrawer: (taskId: string) => void
}) {
  const wf = task._wfProgress
  const isWaiting = wf?.execStatus === 'waiting'
  // AI: 操作菜单状态
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // AI: 归档任务
  async function handleArchive(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (task.status === 'archived') return
    setActionLoading(true)
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      onRefresh()
    } finally {
      setActionLoading(false)
      setMenuOpen(false)
    }
  }

  // AI: 删除任务
  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`确认删除任务「${task.title}」？此操作不可撤销。`)) return
    setActionLoading(true)
    try {
      await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      onRefresh()
    } finally {
      setActionLoading(false)
      setMenuOpen(false)
    }
  }

  return (
    <div className="relative group">
      <div
        onClick={() => onOpenDrawer(task.id)}
        className={`block p-3 bg-surface border rounded-lg hover:bg-accent-subtle transition-colors cursor-pointer ${
          isWaiting
            ? 'border-yellow-300 shadow-sm shadow-yellow-100'
            : 'border-border hover:border-accent'
        }`}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="text-sm font-medium text-text-primary leading-snug flex-1 min-w-0">
            {task.title}
          </div>
          {/* AI: 操作菜单触发按钮（hover 时显示） */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(!menuOpen) }}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface text-text-muted hover:text-text-primary"
            title="更多操作"
          >
            ···
          </button>
        </div>
        {task.description && (
          <div className="text-xs text-text-muted mt-1 line-clamp-2">
            {task.description}
          </div>
        )}

        {/* AI: 工作流执行进度 */}
        {wf && (
          <div className="mt-2 space-y-1">
            {wf.currentStepName && (
              <div className="flex items-center gap-1.5">
                <span className={`text-xs ${
                  wf.execStatus === 'waiting' ? 'text-yellow-600' :
                  wf.execStatus === 'running' ? 'text-status-running' :
                  wf.execStatus === 'done' ? 'text-status-done' :
                  'text-text-muted'
                }`}>
                  {wf.execStatus === 'waiting' ? '⚠ 等待:' :
                   wf.execStatus === 'running' ? '▶ 执行:' :
                   wf.execStatus === 'done' ? '✓' :
                   '◉'}
                </span>
                <span className="text-xs text-text-secondary truncate">{wf.currentStepName}</span>
              </div>
            )}
            {wf.stepsDot.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {wf.stepsDot.map((status, i) => (
                  <div
                    key={i}
                    title={status}
                    className={`w-2 h-2 rounded-full ${DOT_COLOR[status] ?? 'bg-border'}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {task.agentName && (
            <span className="text-xs text-text-muted bg-background border border-border-subtle px-1.5 py-0.5 rounded font-mono">
              {task.agentName}
            </span>
          )}
          {task.workflowId && !wf && (
            <span className="text-xs text-text-muted font-mono">{task.workflowId}</span>
          )}
          <span className="text-xs text-text-muted ml-auto">
            {task.mode === 'lightweight' ? '轻量' : '工作流'}
          </span>
        </div>
      </div>

      {/* AI: 下拉操作菜单 */}
      {menuOpen && (
        <>
          {/* 点击空白区域关闭菜单 */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-8 z-20 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[110px]">
            {task.status !== 'archived' && (
              <button
                onClick={handleArchive}
                disabled={actionLoading}
                className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
              >
                归档
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="w-full text-left px-3 py-1.5 text-xs text-status-failed hover:bg-status-failed/5 transition-colors disabled:opacity-50"
            >
              {actionLoading ? '处理中...' : '删除'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
/* AI end: TaskCard 结束 */

// ─────────────────────────────────────────────
// AI: 侧拉处理中心 Drawer
// ─────────────────────────────────────────────

/* AI start: ProcessingDrawer — 从右侧滑入的处理中心面板，支持左边缘拖拽调整宽度 */
const DRAWER_MIN_WIDTH = 400
const DRAWER_MAX_WIDTH = 1200
const DRAWER_DEFAULT_WIDTH = 680
// AI: localStorage 持久化 key
const DRAWER_WIDTH_KEY = 'manta:processing-drawer-width'

function ProcessingDrawer({
  open,
  taskId,
  onClose,
}: {
  open: boolean
  taskId: string | null
  onClose: () => void
}) {
  // AI: SSR/客户端 hydration 一致：始终用默认值初始化，挂载后再从 localStorage 恢复
  const [width, setWidth] = useState<number>(DRAWER_DEFAULT_WIDTH)
  useEffect(() => {
    const saved = localStorage.getItem(DRAWER_WIDTH_KEY)
    if (saved) {
      const n = Number(saved)
      if (n >= DRAWER_MIN_WIDTH && n <= DRAWER_MAX_WIDTH) setWidth(n)
    }
  }, [])
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  // AI: 鼠标按下拖拽手柄，记录起始位置和宽度
  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    setIsDragging(true)

    function onMouseMove(ev: MouseEvent) {
      // AI: 向左拖动（clientX 减小）=> 宽度增大
      const delta = dragStartX.current - ev.clientX
      const newWidth = Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, dragStartWidth.current + delta))
      setWidth(newWidth)
    }

    function onMouseUp() {
      setIsDragging(false)
      // AI: 拖拽结束时将最终宽度持久化到 localStorage
      setWidth((prev) => {
        localStorage.setItem(DRAWER_WIDTH_KEY, String(prev))
        return prev
      })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <>
      {/* 遮罩层 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}
      {/* 侧拉面板 */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col bg-background border-l border-border shadow-2xl"
        style={{
          width: `${width}px`,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: isDragging ? 'none' : 'transform 0.3s ease',
        }}
      >
        {/* AI: 左边缘拖拽手柄 */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 h-full w-1 z-10 group cursor-col-resize select-none"
          title="拖拽调整宽度"
        >
          {/* AI: 悬停/拖拽时显示高亮线 */}
          <div
            className="absolute inset-y-0 left-0 w-1 transition-colors"
            style={{
              backgroundColor: isDragging ? 'var(--color-accent)' : 'transparent',
            }}
          />
          <div
            className="absolute inset-y-0 left-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
        </div>

        {/* 面板头部 */}
        <div
          style={{ height: 'var(--header-height)' }}
          className="flex items-center justify-between px-5 border-b border-border flex-shrink-0"
        >
          <h2 className="text-sm font-semibold text-text-primary">处理中心</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface transition-colors text-base"
            title="关闭"
          >
            ✕
          </button>
        </div>
        {/* 面板内容 */}
        <div className="flex-1 overflow-hidden">
          {open && taskId ? (
            <ProcessingPanel initTaskId={taskId} onTaskDeleted={onClose} />
          ) : open ? (
            <ProcessingPanel initTaskId={null} onTaskDeleted={onClose} />
          ) : null}
        </div>
      </div>

      {/* AI: 拖拽时禁止全局文本选择 */}
      {isDragging && (
        <style>{`* { user-select: none !important; cursor: col-resize !important; }`}</style>
      )}
    </>
  )
}
/* AI end: ProcessingDrawer 结束 */

/* AI start: ProcessingPanel — 处理中心内容（原 processing/page.tsx 的逻辑内联） */
function ProcessingPanel({
  initTaskId,
  onTaskDeleted,
}: {
  initTaskId: string | null
  onTaskDeleted: () => void
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [outputContent, setOutputContent] = useState<string | null>(null)
  // AI: 多文件 tab 切换
  const [outputFiles, setOutputFiles] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [outputLoading, setOutputLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'inbox' | 'all'>('all')
  const [note, setNote] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  // AI: 工作流执行实例 + 定义
  const [wfExec, setWfExec] = useState<WorkflowExecution | null>(null)
  const [wfDef, setWfDef] = useState<WorkflowDef | null>(null)
  const [wfActionLoading, setWfActionLoading] = useState(false)
  // AI: 用 ref 标记初始选中是否完成
  const initSelectedRef = useRef(false)

  useEffect(() => {
    // AI: 重置初始选中标记，确保每次打开都能重新初始选中
    initSelectedRef.current = false
    fetchTasks()
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initTaskId])

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      const all: Task[] = data.tasks ?? []
      setTasks(all)

      // AI: 若指定了 taskId 且尚未完成初始选中，自动选中该任务
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

  // AI: 加载工作流执行详情
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

  // AI: 调用 /run API 触发 Runner 执行
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
        onTaskDeleted()
      }
    } finally {
      setActionLoading(false)
    }
  }

  const displayTasks = viewMode === 'inbox'
    ? tasks.filter((t) => NEEDS_ACTION_STATUSES.includes(t.status))
    : tasks

  return (
    <div className="flex h-full">
      {/* 左侧任务列表 */}
      <div className="w-56 border-r border-border flex flex-col flex-shrink-0">
        {/* 视图切换 */}
        <div className="flex items-center gap-1 p-2 border-b border-border">
          <button
            onClick={() => setViewMode('inbox')}
            className={`flex-1 py-1 text-xs rounded transition-colors ${
              viewMode === 'inbox'
                ? 'bg-background text-text-primary shadow-sm border border-border'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            待处理
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`flex-1 py-1 text-xs rounded transition-colors ${
              viewMode === 'all'
                ? 'bg-background text-text-primary shadow-sm border border-border'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            全部
          </button>
        </div>
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
              className={`w-full text-left p-3 hover:bg-surface transition-colors ${
                selected?.id === task.id ? 'bg-accent-subtle border-l-2 border-l-accent' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{task.title}</p>
                  {task.agentName && (
                    <p className="text-xs text-text-muted mt-0.5 font-mono truncate">{task.agentName}</p>
                  )}
                </div>
                <ProcStatusDot status={task.status} />
              </div>
              <p className="text-xs text-text-muted mt-1">{formatRelative(task.updatedAt)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧详情 */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 任务标题栏 */}
          <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">{selected.title}</h3>
              {selected.description && (
                <p className="text-xs text-text-muted mt-0.5">{selected.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <ProcStatusBadge status={selected.status} />
                {selected.agentName && (
                  <span className="text-xs text-text-muted font-mono">Agent: {selected.agentName}</span>
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
          <div className="flex-1 overflow-auto p-4">
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
                <pre className="text-sm text-text-primary font-mono whitespace-pre-wrap leading-relaxed bg-surface rounded-lg p-4 border border-border-subtle overflow-x-auto">
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
          <div className="border-t border-border p-4 bg-surface flex-shrink-0">
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
  )
}
/* AI end: ProcessingPanel 结束 */

// ─────────────────────────────────────────────
// AI: 状态展示组件
// ─────────────────────────────────────────────

// AI: 状态点
function ProcStatusDot({ status }: { status: TaskStatus }) {
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

function ProcStatusBadge({ status }: { status: TaskStatus }) {
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
    <div className="space-y-2">
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

// ─────────────────────────────────────────────
// AI: 工作流步骤时间线组件
// ─────────────────────────────────────────────

// AI: 步骤实时日志查看器 — 轮询展示日志
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

                {/* AI: agent 步骤实时日志 */}
                {step.type === 'agent' && (status === 'running' || status === 'done' || status === 'failed') && (
                  <StepLogViewer
                    taskId={exec.taskId}
                    stepId={step.id}
                    active={status === 'running'}
                  />
                )}

                {/* AI: human_in_loop 等待操作按钮 */}
                {isCurrentWaiting && step.type === 'human_in_loop' && log?.actions && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {Object.entries(log.actions).map(([key, targetStep]) => (
                      <button
                        key={key}
                        onClick={() => onAction(key)}
                        disabled={actionLoading}
                        className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                          key === 'approve'
                            ? 'bg-accent text-text-inverse hover:bg-accent-hover'
                            : key === 'reject'
                            ? 'bg-red-50 text-status-failed border border-status-failed/30 hover:bg-red-100'
                            : 'bg-surface text-text-secondary border border-border hover:bg-accent-subtle'
                        } disabled:opacity-50`}
                      >
                        {actionLoading ? '处理中...' : (
                          key === 'approve' ? '✓ 批准'
                          : key === 'reject'  ? '✗ 拒绝'
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

// ─────────────────────────────────────────────
// AI: 新建任务弹窗 + 相关组件
// ─────────────────────────────────────────────

// AI: 工作流定义精简类型（新建任务弹窗用）
interface WorkflowDefBrief {
  id: string
  name: string
  description?: string
  steps: { id: string }[]
}

// AI: 新建任务弹窗 — 支持轻量模式（选 Agent）和工作流模式（选工作流）
function NewTaskModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    mode: 'lightweight' as 'lightweight' | 'workflow',
    agentName: '',
    workflowId: '',
    workDir: '',
  })
  const [agents, setAgents] = useState<{ name: string; runnerId: string; pluginId?: string }[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDefBrief[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // AI: 加载可用的 Agent 列表 + 工作流列表
  useEffect(() => {
    fetch('/api/agents?enabled=true')
      .then((r) => r.json())
      .then((data) => {
        const list = data.agents ?? []
        setAgents(list)
        if (list.length > 0 && !form.agentName) {
          setForm((f) => ({ ...f, agentName: list[0].name }))
        }
      })
      .catch(() => {})

    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data) => {
        const list: WorkflowDefBrief[] = data.workflows ?? []
        setWorkflows(list)
        if (list.length > 0 && !form.workflowId) {
          setForm((f) => ({ ...f, workflowId: list[0].id }))
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit() {
    if (!form.title.trim()) {
      setError('任务标题不能为空')
      return
    }
    if (form.mode === 'lightweight' && !form.agentName) {
      setError('请选择一个 Agent')
      return
    }
    if (form.mode === 'workflow' && !form.workflowId) {
      setError('请选择一个工作流')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          mode: form.mode,
          agentName: form.mode === 'lightweight' ? form.agentName : undefined,
          workflowId: form.mode === 'workflow' ? form.workflowId : undefined,
          // AI: 工作目录（可选），非空时传给后端
          workDir: form.workDir.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '创建失败')
        return
      }
      onSuccess()
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-base font-semibold text-text-primary mb-4">新建任务</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">任务标题 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="描述你想让 Agent 完成的工作..."
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述（可选）</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="更多上下文..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">执行模式</label>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as 'lightweight' | 'workflow' })}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="lightweight">轻量模式（直接指定 Agent）</option>
              <option value="workflow">工作流编排（多步骤）</option>
            </select>
          </div>

          {/* AI: 轻量模式 — 选择 Agent */}
          {form.mode === 'lightweight' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                选择 Agent
                <span className="ml-1 text-text-muted font-normal">（来自插件目录扫描）</span>
              </label>
              <select
                value={form.agentName}
                onChange={(e) => setForm({ ...form, agentName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent font-mono"
              >
                {agents.length === 0 && (
                  <option value="" disabled>扫描中... / 未发现 Agent</option>
                )}
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.pluginId ?? a.runnerId})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* AI: 工作流模式 — 选择工作流 */}
          {form.mode === 'workflow' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                选择工作流
                <span className="ml-1 text-text-muted font-normal">（来自 workflows/*.yaml）</span>
              </label>
              <select
                value={form.workflowId}
                onChange={(e) => setForm({ ...form, workflowId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent"
              >
                {workflows.length === 0 && (
                  <option value="" disabled>加载中... / 未发现工作流</option>
                )}
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} ({wf.steps.length} 步)
                  </option>
                ))}
              </select>
              {/* AI: 当前所选工作流的描述 */}
              {form.workflowId && (() => {
                const wf = workflows.find((w) => w.id === form.workflowId)
                return wf?.description ? (
                  <p className="text-xs text-text-muted mt-1">{wf.description}</p>
                ) : null
              })()}
            </div>
          )}

          {/* AI start: 工作目录（可选）— 告知 Agent 在哪个文件夹下修改代码 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              工作目录
              <span className="ml-1 text-text-muted font-normal">（可选，Agent 将在此目录下修改文件）</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.workDir}
                onChange={(e) => setForm({ ...form, workDir: e.target.value })}
                placeholder="/Users/yourname/projects/my-app"
                className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
              {/* AI: 浏览按钮 — 优先用 Electron dialog，降级到浏览器 File System Access API */}
              <SelectDirectoryButton
                onSelect={(dir) => setForm((f) => ({ ...f, workDir: dir }))}
              />
            </div>
          </div>
          {/* AI end: 工作目录输入结束 */}

          {error && <p className="text-xs text-status-failed">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {loading ? '创建中...' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* AI start: SelectDirectoryButton — Electron 用原生 dialog 获取完整路径，浏览器用 showDirectoryPicker 获取目录名 */
function SelectDirectoryButton({ onSelect }: { onSelect: (dir: string) => void }) {
  const [picking, setPicking] = useState(false)

  // AI: 检测 Electron 环境
  const electronSelectDirectory = typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: { selectDirectory?: () => Promise<string | null> } })
        .electronAPI?.selectDirectory
    : undefined

  // AI: 检测浏览器 File System Access API
  const hasBrowserPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  // AI: 两种 API 都不可用时不渲染按钮
  if (!electronSelectDirectory && !hasBrowserPicker) return null

  async function handleClick() {
    setPicking(true)
    try {
      if (electronSelectDirectory) {
        // AI: Electron — 调用系统原生文件夹对话框，返回完整绝对路径
        const dir = await electronSelectDirectory()
        if (dir) onSelect(dir)
      } else {
        // AI: 浏览器 — showDirectoryPicker 只能获取目录名（浏览器安全限制），填入目录名
        const handle = await (window as unknown as {
          showDirectoryPicker: () => Promise<{ name: string }>
        }).showDirectoryPicker()
        onSelect(handle.name)
      }
    } catch {
      // AI: 用户取消选择，忽略
    } finally {
      setPicking(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={picking}
      className="px-3 py-2 text-xs border border-border rounded-md bg-surface text-text-secondary hover:bg-accent-subtle transition-colors flex-shrink-0 disabled:opacity-50"
    >
      {picking ? '选择中...' : '浏览...'}
    </button>
  )
}
/* AI end: SelectDirectoryButton 结束 */

/*  end: 看板页结束 */
