'use client'
import { useEffect, useState } from 'react'
import { useTasksStore } from '@/store/tasksStore'
import type { Task, TaskStatus } from '@/lib/types'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from '@/lib/types'
import { Plus, RefreshCw, ChevronRight } from 'lucide-react'

/* AI start: 任务看板页面 — 按状态列展示任务 */

const COLUMNS: TaskStatus[] = [
  'Inbox', 'Architecting', 'PendingApproval', 'Developing',
  'ParallelReview', 'PendingScore', 'Done', 'Blocked',
]

const COL_COLORS: Record<TaskStatus, string> = {
  Inbox: '#4a5568',
  Architecting: '#2b6cb0',
  PendingApproval: '#b7791f',
  Developing: '#553c9a',
  ParallelReview: '#6b46c1',
  PendingScore: '#c05621',
  Done: '#276749',
  Blocked: '#9b2c2c',
  Cancelled: '#2d3748',
}

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { createTask } = useTasksStore()
  const [form, setForm] = useState({
    title: '',
    description: '',
    workflowId: 'dev-standard',
    requirementDoc: '',
    backendDesign: '',
    repos: '',
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await createTask({
        ...form,
        repos: form.repos ? form.repos.split('\n').map(s => s.trim()).filter(Boolean) : [],
      })
      onCreated()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-xl p-6" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
        <h2 className="text-lg font-bold text-white mb-4">📋 创建新任务</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>任务标题 *</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="例：用户中心改版 — 新增地址管理功能"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>任务描述</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>工作流</label>
            <select
              value={form.workflowId}
              onChange={e => setForm(f => ({ ...f, workflowId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            >
              <option value="dev-standard">标准前端开发流</option>
              <option value="quick-fix">快速修复流</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>需求文档路径</label>
            <input
              value={form.requirementDoc}
              onChange={e => setForm(f => ({ ...f, requirementDoc: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="/path/to/requirement.md"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>后端技术方案路径</label>
            <input
              value={form.backendDesign}
              onChange={e => setForm(f => ({ ...f, backendDesign: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="/path/to/backend-design.md"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>关联仓库（每行一个）</label>
            <textarea
              value={form.repos}
              onChange={e => setForm(f => ({ ...f, repos: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="https://github.com/org/repo-a&#10;https://github.com/org/repo-b"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm"
              style={{ background: '#2d3148', color: '#a0aec0' }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#3b82f6' }}
            >
              {loading ? '创建中...' : '创建任务'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="p-3 rounded-lg cursor-pointer transition-colors hover:border-blue-500"
      style={{ background: '#1e2130', border: '1px solid #2d3148' }}
    >
      <div className="text-sm font-medium text-white leading-snug mb-1.5 line-clamp-2">{task.title}</div>
      {task.description && (
        <div className="text-xs mb-2 line-clamp-2" style={{ color: '#8892a4' }}>{task.description}</div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#0f1117', color: '#8892a4' }}>
          {task.workflowId === 'dev-standard' ? '标准流' : '快速修复'}
        </span>
        <span className="text-xs" style={{ color: '#4a5568' }}>
          {new Date(task.updatedAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
  )
}

function TaskDetailModal({ task, onClose, onRefresh }: { task: Task; onClose: () => void; onRefresh: () => void }) {
  const { updateStatus, approveTask } = useTasksStore()
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setLoading(true)
    try {
      await updateStatus(task.id, newStatus, 'you', note || undefined)
      onRefresh()
      onClose()
    } catch (e: unknown) {
      alert((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl max-h-screen overflow-y-auto rounded-xl p-6 m-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">{task.title}</h2>
            <span className={`badge ${TASK_STATUS_COLORS[task.status]} text-white text-xs mt-1`}>
              {TASK_STATUS_LABELS[task.status]}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        {task.description && (
          <p className="text-sm mb-4" style={{ color: '#a0aec0' }}>{task.description}</p>
        )}

        {/* AI: 任务流转历史 */}
        {task.history.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-medium mb-2" style={{ color: '#8892a4' }}>流转历史</h3>
            <div className="space-y-1.5">
              {task.history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs" style={{ color: '#8892a4' }}>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: '#0f1117' }}>{TASK_STATUS_LABELS[h.from]}</span>
                  <ChevronRight size={12} />
                  <span className="px-1.5 py-0.5 rounded" style={{ background: '#0f1117' }}>{TASK_STATUS_LABELS[h.to]}</span>
                  <span style={{ color: '#4a5568' }}>by {h.agent}</span>
                  {h.note && <span style={{ color: '#4a5568' }}>· {h.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI: 快速流转按钮 */}
        <div className="border-t pt-4" style={{ borderColor: '#2d3148' }}>
          <div className="mb-2">
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="备注（可选）"
              className="w-full px-3 py-1.5 rounded text-xs text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {task.status === 'Inbox' && (
              <button
                onClick={() => handleStatusChange('Architecting')}
                disabled={loading}
                className="px-3 py-1.5 rounded text-xs text-white"
                style={{ background: '#2b6cb0' }}
              >
                → 派给 Architect
              </button>
            )}
            {task.status === 'Developing' && (
              <button
                onClick={() => handleStatusChange('ParallelReview')}
                disabled={loading}
                className="px-3 py-1.5 rounded text-xs text-white"
                style={{ background: '#6b46c1' }}
              >
                → 开发完成，触发 QA + Review
              </button>
            )}
            {(task.status === 'Inbox' || task.status === 'Developing') && (
              <button
                onClick={() => handleStatusChange('Blocked')}
                disabled={loading}
                className="px-3 py-1.5 rounded text-xs text-white"
                style={{ background: '#9b2c2c' }}
              >
                → 标记阻塞
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KanbanPage() {
  const { tasks, loading, fetchTasks } = useTasksStore()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  useEffect(() => {
    fetchTasks()
    // AI: 每 15 秒自动刷新，参照 edict 15s 同步机制
    const timer = setInterval(fetchTasks, 15000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col] = tasks.filter(t => t.status === col)
    return acc
  }, {} as Record<TaskStatus, Task[]>)

  return (
    <div className="flex flex-col h-screen">
      {/* AI: 顶部工具栏 */}
      <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">任务看板</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>{tasks.length} 个任务 · 每 15s 自动刷新</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchTasks()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ background: '#3b82f6' }}
          >
            <Plus size={12} />
            新建任务
          </button>
        </div>
      </div>

      {/* AI: 看板列 */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 min-w-max h-full">
          {COLUMNS.map(col => (
            <div key={col} className="w-60 flex flex-col flex-shrink-0">
              {/* AI: 列标题 */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-t-lg mb-1"
                style={{ background: COL_COLORS[col] + '33', border: `1px solid ${COL_COLORS[col]}44` }}
              >
                <span className="text-xs font-medium text-white">{TASK_STATUS_LABELS[col]}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-mono"
                  style={{ background: COL_COLORS[col] + '66', color: '#fff' }}
                >
                  {tasksByStatus[col]?.length ?? 0}
                </span>
              </div>
              {/* AI: 任务卡片 */}
              <div className="flex-1 space-y-2 overflow-y-auto">
                {tasksByStatus[col]?.map(task => (
                  <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                ))}
                {(tasksByStatus[col]?.length === 0) && (
                  <div className="text-center py-6 text-xs" style={{ color: '#4a5568' }}>空</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={fetchTasks} />
      )}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onRefresh={fetchTasks}
        />
      )}
    </div>
  )
}
/* AI end: 任务看板页面 */
