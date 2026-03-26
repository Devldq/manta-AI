import { create } from 'zustand'
import type { Task, TaskStatus } from '@/lib/types'

/* AI start: 任务状态管理 Store */
interface TasksState {
  tasks: Task[]
  loading: boolean
  showDeleted: boolean       // AI: 是否显示已删除任务
  showAllDone: boolean       // AI: 是否显示超过24h的已完成任务
  setShowDeleted: (v: boolean) => void
  setShowAllDone: (v: boolean) => void
  fetchTasks: () => Promise<void>
  createTask: (data: Partial<Task>) => Promise<Task>
  updateStatus: (id: string, status: TaskStatus, agent?: string, note?: string) => Promise<void>
  approveTask: (id: string, action: 'approve' | 'reject', note?: string) => Promise<void>
  softDeleteTask: (id: string) => Promise<void>    // AI: 软删除任务
  restoreTask: (id: string) => Promise<void>        // AI: 恢复已删除任务
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  showDeleted: false,
  showAllDone: false,

  setShowDeleted: (v) => {
    set({ showDeleted: v })
    // AI: 切换开关后重新拉取数据
    setTimeout(() => get().fetchTasks(), 0)
  },

  setShowAllDone: (v) => {
    set({ showAllDone: v })
    setTimeout(() => get().fetchTasks(), 0)
  },

  fetchTasks: async () => {
    const { showDeleted, showAllDone } = get()
    set({ loading: true })
    try {
      const params = new URLSearchParams()
      if (showDeleted) params.set('showDeleted', 'true')
      if (showAllDone) params.set('showAllDone', 'true')
      const res = await fetch(`/api/tasks?${params}`)
      const tasks = await res.json()
      set({ tasks })
    } finally {
      set({ loading: false })
    }
  },

  createTask: async (data) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const task = await res.json()
    set(s => ({ tasks: [task, ...s.tasks] }))
    return task
  },

  updateStatus: async (id, status, agent = 'system', note) => {
    const res = await fetch(`/api/tasks/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, agent, note }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error)
    }
    const updated = await res.json()
    set(s => ({ tasks: s.tasks.map(t => t.id === id ? updated : t) }))
  },

  softDeleteTask: async (id) => {
    const res = await fetch(`/api/tasks/${id}/delete`, { method: 'DELETE' })
    if (!res.ok) throw new Error('软删除失败')
    const updated = await res.json()
    set(s => ({ tasks: s.tasks.map(t => t.id === id ? updated : t) }))
    // AI: 重新拉取（因为可能触发过滤条件变化）
    await get().fetchTasks()
  },

  restoreTask: async (id) => {
    const res = await fetch(`/api/tasks/${id}/delete`, { method: 'POST' })
    if (!res.ok) throw new Error('恢复失败')
    await get().fetchTasks()
  },

  approveTask: async (id, action, note) => {
    const res = await fetch(`/api/tasks/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error)
    }
    const updated = await res.json()
    set(s => ({ tasks: s.tasks.map(t => t.id === id ? updated : t) }))
  },
}))
/* AI end: 任务状态管理 Store */
