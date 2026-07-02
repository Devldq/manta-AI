/* RAG 详情页 Zustand Store —— 知识库详情、文档、检索 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

/** 知识库详情 */
export interface KnowledgeBaseDetail {
  id: string
  name: string
  description: string
  providerId: string
  config: Record<string, unknown>
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

/** 文档信息 */
export interface DocumentInfo {
  id: string
  name: string
  type: string
  size: number
  uploadedAt: string
  processedAt?: string
  chunkCount?: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  error?: string
}

/** 文档分块 */
export interface ChunkPreview {
  id: string
  documentId: string
  content: string
  metadata: Record<string, unknown>
  startIndex?: number
  endIndex?: number
}

/** 检索结果 */
export interface SearchResult {
  chunk: {
    id: string
    documentId: string
    content: string
    metadata: Record<string, unknown>
  }
  score: number
  metadata: Record<string, unknown>
}

interface RAGDetailStore {
  // 知识库详情
  kb: KnowledgeBaseDetail | null
  kbLoading: boolean
  kbError: string | null

  // 文档列表
  documents: DocumentInfo[]
  docsLoading: boolean
  docsError: string | null

  // 分块预览
  chunks: ChunkPreview[]
  chunksLoading: boolean
  chunksError: string | null
  chunksDocId: string | null
  chunksTotal: number

  // 检索
  searchResults: SearchResult[]
  searchLoading: boolean
  searchError: string | null
  searchQuery: string

  // 上传
  uploadProgress: number | null
  uploadError: string | null

  // 操作
  fetchKnowledgeBase: (id: string) => Promise<void>
  fetchDocuments: (kbId: string) => Promise<void>
  fetchChunks: (kbId: string, docId: string) => Promise<void>
  uploadDocument: (kbId: string, file: File) => Promise<boolean>
  deleteDocument: (kbId: string, docId: string) => Promise<boolean>
  search: (kbId: string, query: string, topK?: number) => Promise<void>
  reset: () => void
}

const initialState = {
  kb: null as KnowledgeBaseDetail | null,
  kbLoading: false,
  kbError: null as string | null,

  documents: [] as DocumentInfo[],
  docsLoading: false,
  docsError: null as string | null,

  chunks: [] as ChunkPreview[],
  chunksLoading: false,
  chunksError: null as string | null,
  chunksDocId: null as string | null,
  chunksTotal: 0,

  searchResults: [] as SearchResult[],
  searchLoading: false,
  searchError: null as string | null,
  searchQuery: '',

  uploadProgress: null as number | null,
  uploadError: null as string | null,
}

export const useRAGDetailStore = create<RAGDetailStore>((set, get) => ({
  ...initialState,

  fetchKnowledgeBase: async (id: string) => {
    set({ kbLoading: true, kbError: null })
    try {
      const json = await swrFetch(`rag-kb:${id}`, () =>
        fetch(`/api/rag/knowledge-bases/${id}`).then((r) => r.json())
      )
      if (json.success && json.data?.knowledgeBase) {
        set({ kb: json.data.knowledgeBase, kbLoading: false })
      } else {
        set({ kbLoading: false, kbError: json.error?.message ?? '获取知识库失败' })
      }
    } catch (err) {
      set({ kbLoading: false, kbError: String(err) })
    }
  },

  fetchDocuments: async (kbId: string) => {
    set({ docsLoading: true, docsError: null })
    try {
      const json = await swrFetch(`rag-docs:${kbId}`, () =>
        fetch(`/api/rag/knowledge-bases/${kbId}/documents`).then((r) => r.json())
      )
      if (json.success && json.data?.documents) {
        set({ documents: json.data.documents, docsLoading: false })
      } else {
        set({ documents: [], docsLoading: false, docsError: json.error?.message ?? '获取文档列表失败' })
      }
    } catch (err) {
      set({ docsLoading: false, docsError: String(err) })
    }
  },

  fetchChunks: async (kbId: string, docId: string) => {
    set({ chunksLoading: true, chunksError: null, chunksDocId: docId })
    try {
      const json = await swrFetch(`rag-chunks:${kbId}:${docId}`, () =>
        fetch(`/api/rag/knowledge-bases/${kbId}/documents/${docId}/chunks`).then((r) =>
          r.json()
        )
      )
      if (json.success && json.data) {
        set({
          chunks: json.data.chunks || [],
          chunksTotal: json.data.totalChunks || 0,
          chunksLoading: false,
        })
      } else {
        set({ chunks: [], chunksTotal: 0, chunksLoading: false, chunksError: json.error?.message ?? '获取分块失败' })
      }
    } catch (err) {
      set({ chunksLoading: false, chunksError: String(err) })
    }
  },

  uploadDocument: async (kbId: string, file: File) => {
    set({ uploadProgress: 0, uploadError: null })
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents`, {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()

      if (json.success) {
        set({ uploadProgress: null })
        // 刷新列表和知识库信息
        invalidateCache(`rag-docs:${kbId}`)
        invalidateCache(`rag-kb:${kbId}`)
        await get().fetchDocuments(kbId)
        await get().fetchKnowledgeBase(kbId)
        return true
      }
      set({ uploadProgress: null, uploadError: json.error?.message ?? '上传失败' })
      return false
    } catch (err) {
      set({ uploadProgress: null, uploadError: String(err) })
      return false
    }
  },

  deleteDocument: async (kbId: string, docId: string) => {
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents/${docId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (json.success) {
        invalidateCache(`rag-docs:${kbId}`)
        invalidateCache(`rag-kb:${kbId}`)
        await get().fetchDocuments(kbId)
        await get().fetchKnowledgeBase(kbId)
        return true
      }
      set({ docsError: json.error?.message ?? '删除文档失败' })
      return false
    } catch (err) {
      set({ docsError: String(err) })
      return false
    }
  },

  search: async (kbId: string, query: string, topK?: number) => {
    set({ searchLoading: true, searchError: null, searchQuery: query })
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK }),
      })
      const json = await res.json()
      if (json.success && json.data) {
        set({ searchResults: json.data.results || [], searchLoading: false })
      } else {
        set({ searchResults: [], searchLoading: false, searchError: json.error?.message ?? '检索失败' })
      }
    } catch (err) {
      set({ searchLoading: false, searchError: String(err) })
    }
  },

  reset: () => set(initialState),
}))
