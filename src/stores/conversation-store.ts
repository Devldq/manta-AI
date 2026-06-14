/* Conversation Zustand Store — 会话列表状态管理 */

import { create } from 'zustand'

export interface ConversationSummary {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  workspaceId?: string
}

interface ConversationStore {
  items: ConversationSummary[]
  activeId: string | null
  loading: boolean
  error: string | null

  fetchList: (params?: { workspaceId?: string }) => Promise<void>
  deleteConversation: (id: string) => Promise<boolean>
  setActiveId: (id: string | null) => void
}

let abortController: AbortController | null = null

export const useConversationStore = create<ConversationStore>((set, get) => ({
  items: [],
  activeId: null,
  loading: false,
  error: null,

  fetchList: async (params) => {
    // 取消上次未完成的请求
    if (abortController) {
      abortController.abort()
    }
    abortController = new AbortController()

    set({ loading: true, error: null })
    try {
      const sp = new URLSearchParams()
      if (params?.workspaceId) sp.set('workspaceId', params.workspaceId)
      const qs = sp.toString()
      const res = await fetch(`/api/conversations${qs ? `?${qs}` : ''}`, {
        signal: abortController.signal,
      })
      const json = await res.json()
      if (json.success && json.data?.conversations) {
        set({ items: json.data.conversations, loading: false })
      } else {
        set({ loading: false, error: json.error?.message ?? '获取会话列表失败' })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      set({ loading: false, error: String(err) })
    }
  },

  deleteConversation: async (id) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        set((s) => ({
          items: s.items.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        }))
        return true
      }
      return false
    } catch {
      return false
    }
  },

  setActiveId: (id) => set({ activeId: id }),
}))
