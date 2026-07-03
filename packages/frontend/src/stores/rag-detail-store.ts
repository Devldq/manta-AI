/* RAG 详情页 Zustand Store —— 知识库详情、文档、检索、配置 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

/** 知识库详情 */
export interface KnowledgeBaseDetail {
  id: string
  name: string
  description: string
  providerId: string
  config: KnowledgeBaseConfig
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

/** 知识库配置 */
export interface KnowledgeBaseConfig {
  dimensions: number
  similarityThreshold: number
  topK: number
  hybridSearch?: {
    enabled: boolean
    vectorWeight: number
    keywordWeight: number
  }
  embeddingConfig?: {
    provider: 'openai' | 'local'
    model?: string
    apiKey?: string
    baseUrl?: string
    dimensions?: number
  }
}

/** 可选的 Embedding 模型 */
export interface EmbeddingModelOption {
  id: string
  name: string
  dimensions: number
}

/** Embedding Provider */
export interface EmbeddingProviderOption {
  id: 'openai' | 'local'
  name: string
  models: EmbeddingModelOption[]
}

/** RAG 全局配置 */
export interface RAGConfig {
  supportedFormats: string[]
  maxFileSize: string
  globalProvider: string
  globalModel: string
  availableProviders: EmbeddingProviderOption[]
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

/** 问答消息 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    name: string
    documentId: string
    score: number
  }>
}

/** LLM Profile（供模型选择） */
export interface LLMProfileOption {
  id: string
  name: string
  model: string
  isDefault?: boolean
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
  uploadStage: string | null
  uploadMessage: string | null
  uploadChunkCount: number | null
  uploadError: string | null

  // 配置
  ragConfig: RAGConfig | null
  ragConfigLoading: boolean
  configSaving: boolean
  configError: string | null

  // 问答
  chatMessages: ChatMessage[]
  chatStreaming: boolean
  chatError: string | null
  chatModelId: string | null
  llmProfiles: LLMProfileOption[]

  // 操作
  fetchKnowledgeBase: (id: string) => Promise<void>
  fetchDocuments: (kbId: string) => Promise<void>
  fetchChunks: (kbId: string, docId: string) => Promise<void>
  fetchRAGConfig: () => Promise<void>
  uploadDocument: (kbId: string, file: File) => Promise<boolean>
  deleteDocument: (kbId: string, docId: string) => Promise<boolean>
  search: (kbId: string, query: string, topK?: number) => Promise<void>
  updateConfig: (kbId: string, config: Partial<KnowledgeBaseConfig>) => Promise<boolean>
  sendChat: (kbId: string, question: string) => Promise<void>
  clearChat: () => void
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
  uploadStage: null as string | null,
  uploadMessage: null as string | null,
  uploadChunkCount: null as number | null,
  uploadError: null as string | null,

  ragConfig: null as RAGConfig | null,
  ragConfigLoading: false,
  configSaving: false,
  configError: null as string | null,

  chatMessages: [] as ChatMessage[],
  chatStreaming: false,
  chatError: null as string | null,
  chatModelId: null as string | null,
  llmProfiles: [] as LLMProfileOption[],
}

export const useRAGDetailStore = create<RAGDetailStore>((set, get) => ({
  ...initialState,

  fetchRAGConfig: async () => {
    set({ ragConfigLoading: true })
    try {
      const json = await swrFetch('rag-config', () =>
        fetch('/api/rag/config').then((r) => r.json())
      )
      if (json.success && json.data) {
        const data = json.data as any
        set({
          ragConfig: {
            supportedFormats: data.supportedFormats,
            maxFileSize: data.maxFileSize,
            globalProvider: data.globalProvider,
            globalModel: data.globalModel,
            availableProviders: data.availableProviders,
          } as RAGConfig,
          llmProfiles: (data.llmProfiles || []) as LLMProfileOption[],
          ragConfigLoading: false,
        })
      } else {
        set({ ragConfigLoading: false })
      }
    } catch {
      set({ ragConfigLoading: false })
    }
  },

  updateConfig: async (kbId: string, configPatch: Partial<KnowledgeBaseConfig>) => {
    set({ configSaving: true, configError: null })
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configPatch),
      })
      const json = await res.json()
      if (json.success && json.data?.knowledgeBase) {
        set({ kb: json.data.knowledgeBase as KnowledgeBaseDetail, configSaving: false })
        invalidateCache(`rag-kb:${kbId}`)
        return true
      }
      set({ configSaving: false, configError: json.error?.message ?? '保存配置失败' })
      return false
    } catch (err) {
      set({ configSaving: false, configError: String(err) })
      return false
    }
  },

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
    set({
      uploadProgress: 0,
      uploadStage: 'uploading',
      uploadMessage: '正在上传文件...',
      uploadChunkCount: null,
      uploadError: null,
    })
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents?stream=progress`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadError: json.error?.message ?? '上传失败' })
        return false
      }

      const reader = res.body?.getReader()
      if (!reader) {
        set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadError: '无法读取响应流' })
        return false
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const { done: readerDone, value } = await reader.read()
        if (readerDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            switch (event.type) {
              case 'progress': {
                const chunkMatch = event.message?.match(/(\d+)\/(\d+)/)
                const chunkCount = chunkMatch ? parseInt(chunkMatch[1], 10) : null
                set({
                  uploadStage: event.stage,
                  uploadProgress: event.progress,
                  uploadMessage: event.message,
                  uploadChunkCount: chunkCount,
                })
                break
              }
              case 'done': {
                done = true
                set({
                  uploadProgress: 100,
                  uploadStage: 'done',
                  uploadMessage: `处理完成，共 ${event.chunkCount ?? 0} 个分块`,
                  uploadChunkCount: event.chunkCount ?? null,
                })
                break
              }
              case 'error': {
                done = true
                set({
                  uploadProgress: null,
                  uploadStage: null,
                  uploadMessage: null,
                  uploadError: event.error ?? '处理失败',
                })
                break
              }
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }

      // 短暂展示完成后清理状态
      if (get().uploadStage === 'done') {
        await new Promise((resolve) => setTimeout(resolve, 600))
      }

      set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadChunkCount: null })
      // 刷新列表和知识库信息
      invalidateCache(`rag-docs:${kbId}`)
      invalidateCache(`rag-kb:${kbId}`)
      await get().fetchDocuments(kbId)
      await get().fetchKnowledgeBase(kbId)
      return true
    } catch (err) {
      set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadChunkCount: null, uploadError: String(err) })
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

  sendChat: async (kbId: string, question: string) => {
    const { chatModelId } = get()
    const userMsg: ChatMessage = { role: 'user', content: question }

    set((s) => ({
      chatMessages: [...s.chatMessages, userMsg, { role: 'assistant', content: '' }],
      chatStreaming: true,
      chatError: null,
    }))

    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, profileId: chatModelId || undefined }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        throw new Error(json.error?.message || `请求失败 (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            switch (event.type) {
              case 'token':
                set((s) => {
                  const msgs = [...s.chatMessages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, content: last.content + event.text }
                  }
                  return { chatMessages: msgs }
                })
                break
              case 'sources':
                set((s) => {
                  const msgs = [...s.chatMessages]
                  const last = msgs[msgs.length - 1]
                  if (last?.role === 'assistant') {
                    msgs[msgs.length - 1] = { ...last, sources: event.sources }
                  }
                  return { chatMessages: msgs }
                })
                break
              case 'done':
                // 流完成，不需要额外操作
                break
              case 'error':
                throw new Error(event.error)
            }
          } catch (e) {
            if ((e as Error).message.startsWith('data: ')) continue
            throw e
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      set((s) => {
        const msgs = [...s.chatMessages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          // 错误且回答为空，移除空消息
          msgs.pop()
        }
        return { chatMessages: msgs, chatError: errMsg }
      })
    } finally {
      set({ chatStreaming: false })
    }
  },

  clearChat: () => {
    set({ chatMessages: [], chatError: null })
  },

  reset: () => set(initialState),
}))
