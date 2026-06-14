/* Workspace Zustand Store — 工作空间列表状态管理（Phase 1: mock 数据） */

import { create } from 'zustand'

export interface WorkspaceSummary {
  id: string
  name: string
  description?: string
  conversationCount: number
  createdAt: string
  updatedAt: string
}

interface WorkspaceStore {
  items: WorkspaceSummary[]
  expandedIds: Set<string>
  loading: boolean
  error: string | null

  fetchList: () => Promise<void>
  toggleExpand: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  items: [],
  expandedIds: new Set(),
  loading: false,
  error: null,

  fetchList: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/workspaces')
      if (!res.ok) {
        // Phase 1: API 不存在时返回空列表
        set({ items: [], loading: false })
        return
      }
      const data = await res.json()
      if (data.workspaces) {
        set({ items: data.workspaces, loading: false })
      } else {
        set({ items: [], loading: false })
      }
    } catch {
      // Phase 1: API 尚未实现，静默处理
      set({ items: [], loading: false })
    }
  },

  toggleExpand: (id) => {
    set((s) => {
      const next = new Set(s.expandedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedIds: next }
    })
  },
}))
