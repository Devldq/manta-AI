import { create } from 'zustand'
import type { Task, TaskStatus } from '@/lib/types'

/* AI start: 任务状态管理 Store */
interface TasksState {
  tasks: Task[]
  loading: boolean
  fetchTasks: (filters?: { status?: TaskStatus; workflowId?: string }) => Promise<void>
  createTask: (data: Partial<Task>) => Promise<Task>
  updateStatus: (id: string, status: TaskStatus, agent?: string, note?: string) => Promise<void>
  approveTask: (id: string, action: 'approve' | 'reject', note?: string) => Promise<void>
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,

  fetchTasks: async (filters) => {
    set({ loading: true })
    try {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.workflowId) params.set('workflowId', filters.workflowId)
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
