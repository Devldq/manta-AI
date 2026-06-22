/* Workspace Zustand Store — 工作空间列表状态管理 */

import { create } from 'zustand'
import type { WorkspaceConfig, CreateWorkspaceInput, UpdateWorkspaceInput } from '@manta/shared'
import type { ConversationSummary } from '@/stores/conversation-store'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

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
  /** 缓存每个工作空间的会话列表，切换 tab 时不会丢失 */
  conversationsByWs: Record<string, ConversationSummary[]>
  /** 正在加载的工作空间 ID 集合 */
  loadingWsIds: Set<string>

  fetchList: () => Promise<void>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceConfig | null>
  updateWorkspace: (id: string, patch: UpdateWorkspaceInput) => Promise<WorkspaceConfig | null>
  deleteWorkspace: (id: string) => Promise<boolean>
  toggleExpand: (id: string) => void
  /** 加载指定工作空间的会话列表（带缓存） */
  fetchConversations: (wsId: string, force?: boolean) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  items: [],
  expandedIds: new Set(),
  loading: false,
  error: null,
  conversationsByWs: {},
  loadingWsIds: new Set(),

  fetchList: async () => {
    const hasData = get().items.length > 0
    if (!hasData) set({ loading: true, error: null }) // 有数据时不阻塞 UI
    try {
      const key = 'workspaces:list'
      const json = await swrFetch(key, () =>
        fetch('/api/workspaces').then(res => {
          if (!res.ok) throw new Error('Failed to fetch workspaces')
          return res.json()
        })
      )
      if (json.success && json.data?.workspaces) {
        // 默认折叠所有工作空间（用户点击展开时按需加载）
        set({ items: json.data.workspaces, loading: false })
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
        invalidateCache('workspaces:') // 清除缓存
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
        invalidateCache('workspaces:') // 清除缓存
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
        invalidateCache('workspaces:') // 清除缓存
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

  fetchConversations: async (wsId: string, force?: boolean) => {
    // 已有缓存或正在加载，跳过（除非强制刷新）
    if (!force && (get().conversationsByWs[wsId] || get().loadingWsIds.has(wsId))) return

    set((s) => ({ loadingWsIds: new Set(s.loadingWsIds).add(wsId) }))
    try {
      const res = await fetch(`/api/conversations?type=workspace&workspaceId=${wsId}`)
      if (res.ok) {
        const data = await res.json()
        set((s) => ({
          conversationsByWs: { ...s.conversationsByWs, [wsId]: data.data?.conversations ?? [] },
        }))
      } else {
        set((s) => ({ conversationsByWs: { ...s.conversationsByWs, [wsId]: [] } }))
      }
    } catch {
      set((s) => ({ conversationsByWs: { ...s.conversationsByWs, [wsId]: [] } }))
    } finally {
      set((s) => {
        const next = new Set(s.loadingWsIds)
        next.delete(wsId)
        return { loadingWsIds: next }
      })
    }
  },
}))
