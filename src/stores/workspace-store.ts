/* Workspace Zustand Store — 工作空间列表状态管理 */

import { create } from 'zustand'
import type { WorkspaceConfig, CreateWorkspaceInput, UpdateWorkspaceInput } from '@/core/types'

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
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceConfig | null>
  updateWorkspace: (id: string, patch: UpdateWorkspaceInput) => Promise<WorkspaceConfig | null>
  deleteWorkspace: (id: string) => Promise<boolean>
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
        set({ items: [], loading: false })
        return
      }
      const json = await res.json()
      if (json.success && json.data?.workspaces) {
        // 默认展开所有工作空间
        const allIds = new Set(json.data.workspaces.map((ws: WorkspaceSummary) => ws.id))
        set({ items: json.data.workspaces, loading: false, expandedIds: allIds })
      } else {
        set({ items: [], loading: false })
      }
    } catch {
      set({ items: [], loading: false })
    }
  },

  createWorkspace: async (input) => {
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json()
      if (json.success && json.data?.workspace) {
        await get().fetchList()
        return json.data.workspace
      }
      set({ error: json.error?.message ?? '创建工作空间失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  updateWorkspace: async (id, patch) => {
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (json.success && json.data?.workspace) {
        await get().fetchList()
        return json.data.workspace
      }
      set({ error: json.error?.message ?? '更新工作空间失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  deleteWorkspace: async (id) => {
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        await get().fetchList()
        return true
      }
      set({ error: json.error?.message ?? '删除工作空间失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
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
