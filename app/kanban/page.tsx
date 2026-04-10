/*  start: Manta 任务看板页 — 接通真实后端 API */
'use client'

import { useState, useEffect, useCallback } from 'react'

type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

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
  createdAt: string
  updatedAt: string
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

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)

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
    </div>
  )
}

function KanbanColumn({
  column,
  tasks,
  onRefresh,
}: {
  column: { id: TaskStatus; label: string; color: string }
  tasks: Task[]
  onRefresh: () => void
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
          <TaskCard key={task.id} task={task} onRefresh={onRefresh} />
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

/* AI start: TaskCard — 支持快捷操作菜单（归档/删除）*/
function TaskCard({ task, onRefresh }: { task: Task; onRefresh: () => void }) {
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
      <a
        href={`/processing?taskId=${task.id}`}
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
      </a>

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
/*  end: 看板页结束 */

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
