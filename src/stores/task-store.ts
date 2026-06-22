/* Task Zustand Store — 任务列表状态管理 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

export interface TaskSummary {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  workspaceId?: string
}

interface TaskStore {
  items: TaskSummary[]
  activeId: string | null
  loading: boolean
  error: string | null

  fetchList: (params?: { workspaceId?: string }) => Promise<void>
  deleteTask: (id: string) => Promise<boolean>
  sendMessage: (taskId: string, content: string, agentAppId?: string) => Promise<boolean>
  setActiveId: (id: string | null) => void
}

// 正在进行中的 fetchList 调用（防止并发竞态）
let inflightFetch: Promise<void> | null = null

export const useTaskStore = create<TaskStore>((set, get) => ({
  items: [],
  activeId: null,
  loading: false,
  error: null,

  fetchList: async (params) => {
    // 如果已有相同参数的请求在进行中，直接复用
    if (inflightFetch) return inflightFetch

    const hasData = get().items.length > 0
    if (!hasData) set({ loading: true, error: null }) // 有数据时不阻塞 UI

    const fetchPromise = (async () => {
      try {
        const sp = new URLSearchParams()
        if (params?.workspaceId) sp.set('workspaceId', params.workspaceId)
        sp.set('type', params?.workspaceId ? 'workspace' : 'global')
        const qs = sp.toString()
        const key = `tasks:${qs}`
        const json = await swrFetch(key, () =>
          fetch(`/api/tasks${qs ? `?${qs}` : ''}`).then(res => res.json())
        )
        if (json.success && json.data?.tasks) {
          set({ items: json.data.tasks, loading: false })
        } else {
          set({ loading: false, error: json.error?.message ?? '获取任务列表失败' })
        }
      } catch (err) {
        set({ loading: false, error: String(err) })
      } finally {
        inflightFetch = null
      }
    })()

    inflightFetch = fetchPromise
    return fetchPromise
  },

  deleteTask: async (id) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        invalidateCache('tasks:') // 清除缓存
        set((s) => ({
          items: s.items.filter((t) => t.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        }))
        return true
      }
      return false
    } catch {
      return false
    }
  },

  sendMessage: async (taskId, content, agentAppId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, agentAppId }),
      })
      const json = await res.json()
      if (json.success && json.data?.message) {
        // 可以更新任务的最后消息时间等
        return true
      }
      set({ error: json.error?.message ?? '发送消息失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  setActiveId: (id) => set({ activeId: id }),
}))
