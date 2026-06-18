/* RAG Zustand Store — 知识库状态管理 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

export interface KnowledgeBaseSummary {
  id: string
  name: string
  description: string
  providerId: string
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

interface RAGStore {
  knowledgeBases: KnowledgeBaseSummary[]
  loading: boolean
  error: string | null

  fetchKnowledgeBases: (params?: { search?: string }) => Promise<void>
  createKnowledgeBase: (input: {
    name: string
    description?: string
    providerId?: string
    config?: Record<string, unknown>
  }) => Promise<boolean>
  deleteKnowledgeBase: (id: string) => Promise<boolean>
}

export const useRAGStore = create<RAGStore>((set, get) => ({
  knowledgeBases: [],
  loading: false,
  error: null,

  fetchKnowledgeBases: async (params) => {
    const hasData = get().knowledgeBases.length > 0
    if (!hasData) set({ loading: true, error: null }) // 有数据时不阻塞 UI
    try {
      const sp = new URLSearchParams()
      if (params?.search) sp.set('search', params.search)
      const qs = sp.toString()
      const key = `knowledge-bases:${qs}`
      const json = await swrFetch(key, () =>
        fetch(`/api/rag/knowledge-bases${qs ? `?${qs}` : ''}`).then(r => r.json())
      )
      if (json.success && json.data?.knowledgeBases) {
        set({ knowledgeBases: json.data.knowledgeBases, loading: false })
      } else {
        set({ loading: false, error: json.error?.message ?? '获取知识库列表失败' })
      }
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  createKnowledgeBase: async (input) => {
    try {
      const res = await fetch('/api/rag/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json()
      if (json.success && json.data?.knowledgeBase) {
        invalidateCache('knowledge-bases:') // 清除缓存
        await get().fetchKnowledgeBases()
        return true
      }
      set({ error: json.error?.message ?? '创建知识库失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  deleteKnowledgeBase: async (id) => {
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        invalidateCache('knowledge-bases:') // 清除缓存
        await get().fetchKnowledgeBases()
        return true
      }
      set({ error: json.error?.message ?? '删除知识库失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },
}))