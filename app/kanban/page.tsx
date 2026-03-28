/*  start: Manta 任务看板页 — 接通真实后端 API */
'use client'

import { useState, useEffect, useCallback } from 'react'

type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

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
}: {
  column: { id: TaskStatus; label: string; color: string }
  tasks: Task[]
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
          <TaskCard key={task.id} task={task} />
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

function TaskCard({ task }: { task: Task }) {
  return (
    <a
      href={`/processing?taskId=${task.id}`}
      className="block p-3 bg-surface border border-border rounded-lg hover:border-accent hover:bg-accent-subtle transition-colors cursor-pointer"
    >
      <div className="text-sm font-medium text-text-primary leading-snug">
        {task.title}
      </div>
      {task.description && (
        <div className="text-xs text-text-muted mt-1 line-clamp-2">
          {task.description}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.agentName && (
          <span className="text-xs text-text-muted bg-background border border-border-subtle px-1.5 py-0.5 rounded font-mono">
            {task.agentName}
          </span>
        )}
        {task.workflowId && (
          <span className="text-xs text-text-muted">
            {task.workflowId}
          </span>
        )}
        <span className="text-xs text-text-muted ml-auto">
          {task.mode === 'lightweight' ? '轻量' : '工作流'}
        </span>
      </div>
    </a>
  )
}

// AI: 新建任务弹窗 — 从 API 动态加载 Agent 列表（plugin-native + manta-custom）
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
  })
  const [agents, setAgents] = useState<{ name: string; runnerId: string; source?: string; pluginId?: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // AI: 加载可用的 Agent 列表（启用的）
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
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  // AI: 按来源分组 Agent 列表（用于 select 的 optgroup）
  const pluginAgents = agents.filter((a) => a.source === 'plugin-native')
  const customAgents = agents.filter((a) => a.source !== 'plugin-native')

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
              <option value="workflow">完整工作流</option>
            </select>
          </div>
          {form.mode === 'lightweight' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                选择 Agent
                <span className="ml-1 text-text-muted font-normal">（来自插件扫描 + 自定义）</span>
              </label>
              <select
                value={form.agentName}
                onChange={(e) => setForm({ ...form, agentName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent font-mono"
              >
                {agents.length === 0 && (
                  <option value="" disabled>加载中...</option>
                )}
                {pluginAgents.length > 0 && (
                  <optgroup label="插件 Agent">
                    {pluginAgents.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name} ({a.pluginId ?? a.runnerId})
                      </option>
                    ))}
                  </optgroup>
                )}
                {customAgents.length > 0 && (
                  <optgroup label="自定义 Agent">
                    {customAgents.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name} ({a.runnerId})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}
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
