/* RAG 详情页 Zustand Store —— 知识库详情、文档、检索、配置 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'
import {
  saveStagedFiles,
  loadStagedFiles,
  removeStagedFileById,
  clearAllForKb,
  saveBatchMeta,
  loadBatchMeta,
  clearBatchMeta,
} from '@/stores/lib/staged-files-db'

// ── 文档列表轮询定时器（有 processing 文档时自动刷新）─────────
let docPollTimer: ReturnType<typeof setTimeout> | null = null

/** Worker 活跃标记 —— 防止 processStagedFiles 重入 */
let workersActive = false

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
  chunkingConfig?: ChunkingConfig
}

/** 分块配置 */
export interface ChunkingConfig {
  strategy: 'fixed' | 'semantic' | 'recursive'
  chunkSize: number
  overlap: number
  batchConcurrency: number
}

/** 暂存文件（浏览器端暂存，未上传到服务器） */
export interface StagedFile {
  id: string
  file: File
  name: string
  size: number
  type: string
  /** 相对路径（文件夹上传时保留目录结构） */
  relativePath?: string
}

/** 暂存文件处理进度 */
export interface StagedFileProgress {
  stage: 'pending' | 'uploading' | 'parsing' | 'chunking' | 'embedding' | 'storing' | 'done' | 'error'
  progress: number
  error?: string
  /** 开始处理时间（进入 uploading 阶段时记录） */
  startTime?: number
  /** 完成处理时间（done 或 error 时记录） */
  endTime?: number
}

/** 默认分块配置（单位：Token） */
const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  strategy: 'recursive',
  chunkSize: 512,
  overlap: 50,
  batchConcurrency: 5,
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
  metadata: {
    source?: string
    index?: number
    tokenEstimate?: number
    [key: string]: unknown
  }
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
    index?: number
    tokenEstimate?: number
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
  kbSaving: boolean
  kbSaveError: string | null

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

  // 处理前分块预览（暂存文件预览）
  previewChunks: ChunkPreview[]
  previewChunksLoading: boolean
  previewChunksError: string | null
  previewChunksFileName: string | null

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

  // 暂存区（浏览器端暂存文件，未上传到服务器）
  stagedFiles: StagedFile[]
  stagedFileProgress: Record<string, StagedFileProgress>
  chunkingConfig: ChunkingConfig
  /** 当前知识库 ID（用于 IndexedDB 持久化） */
  currentKbId: string | null

  // 批量处理
  batchProcessing: boolean
  batchTotal: number
  batchCompletedCount: number
  batchActiveFiles: { name: string; progress: number; stage: string | null }[]
  batchErrors: string[]
  batchDone: boolean
  /** 批处理过程中新完成的文档ID（用于显示"新"标记，6秒后自动清除） */
  newDocIds: string[]

  // 配置
  ragConfig: RAGConfig | null
  ragConfigLoading: boolean
  configSaving: boolean
  configError: string | null

  // 向量模型检测
  embeddingChecking: boolean
  embeddingCheckResult: { available: boolean; provider?: string; model?: string; dimensions?: number; error?: string } | null

  // 问答
  chatMessages: ChatMessage[]
  chatStreaming: boolean
  chatError: string | null
  chatModelId: string | null
  llmProfiles: LLMProfileOption[]

  // 操作
  fetchKnowledgeBase: (id: string) => Promise<void>
  updateKBInfo: (kbId: string, patch: { name?: string; description?: string }) => Promise<boolean>
  fetchDocuments: (kbId: string, opts?: { silent?: boolean }) => Promise<void>
  fetchChunks: (kbId: string, docId: string) => Promise<void>
  fetchRAGConfig: () => Promise<void>
  /** 处理前预览：上传文件到后端解析+分块，不向量化不存储 */
  fetchChunkPreview: (kbId: string, file: File, chunkingConfig?: ChunkingConfig) => Promise<void>
  clearPreviewChunks: () => void
  uploadDocument: (kbId: string, file: File, chunkingConfig?: ChunkingConfig) => Promise<boolean>
  deleteDocument: (kbId: string, docId: string) => Promise<boolean>
  search: (kbId: string, query: string, topK?: number) => Promise<void>
  updateConfig: (kbId: string, config: Partial<KnowledgeBaseConfig>) => Promise<boolean>
  sendChat: (kbId: string, question: string) => Promise<void>
  clearChat: () => void
  reset: () => void

  /** 检查是否有 processing 文档，如有则自动启动轮询 */
  checkProcessingDocs: (kbId: string) => void
  /** 停止文档轮询 */
  stopDocPolling: () => void

  // 暂存区操作
  addStagedFiles: (files: File[]) => void
  removeStagedFile: (id: string) => void
  clearStagedFiles: () => void
  updateChunkingConfig: (config: Partial<ChunkingConfig>) => void
  /** 批量处理所有暂存文件，逐个上传并处理 */
  processStagedFiles: (kbId: string, options?: { alreadyCompleted?: number }) => Promise<void>
  /** 移除单个暂存文件 */
  removeStagedFileById: (id: string) => void
  /** 刷新页面后恢复未完成的批处理会话 */
  restoreBatchSession: (kbId: string) => Promise<void>
  /** 检测向量模型是否可用（处理前校验） */
  checkEmbeddingHealth: (kbId: string) => Promise<boolean>
}

const initialState = {
  kb: null as KnowledgeBaseDetail | null,
  kbLoading: false,
  kbError: null as string | null,
  kbSaving: false,
  kbSaveError: null as string | null,

  documents: [] as DocumentInfo[],
  docsLoading: false,
  docsError: null as string | null,

  chunks: [] as ChunkPreview[],
  chunksLoading: false,
  chunksError: null as string | null,
  chunksDocId: null as string | null,
  chunksTotal: 0,

  previewChunks: [] as ChunkPreview[],
  previewChunksLoading: false,
  previewChunksError: null as string | null,
  previewChunksFileName: null as string | null,

  searchResults: [] as SearchResult[],
  searchLoading: false,
  searchError: null as string | null,
  searchQuery: '',

  uploadProgress: null as number | null,
  uploadStage: null as string | null,
  uploadMessage: null as string | null,
  uploadChunkCount: null as number | null,
  uploadError: null as string | null,

  stagedFiles: [] as StagedFile[],
  stagedFileProgress: {} as Record<string, StagedFileProgress>,
  chunkingConfig: { ...DEFAULT_CHUNKING_CONFIG } as ChunkingConfig,
  currentKbId: null as string | null,

  batchProcessing: false,
  batchTotal: 0,
  batchCompletedCount: 0,
  batchActiveFiles: [] as { name: string; progress: number; stage: string | null }[],
  batchErrors: [] as string[],
  batchDone: false,
  newDocIds: [] as string[],

  ragConfig: null as RAGConfig | null,
  ragConfigLoading: false,
  configSaving: false,
  configError: null as string | null,

  embeddingChecking: false,
  embeddingCheckResult: null as { available: boolean; provider?: string; model?: string; dimensions?: number; error?: string } | null,

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
    set({ kbLoading: true, kbError: null, currentKbId: id })
    try {
      const json = await swrFetch(`rag-kb:${id}`, () =>
        fetch(`/api/rag/knowledge-bases/${id}`).then((r) => r.json())
      )
      if (json.success && json.data?.knowledgeBase) {
        const kb = json.data.knowledgeBase as KnowledgeBaseDetail
        // 同步 KB 配置中的分块配置到 store
        if (kb.config?.chunkingConfig) {
          set({ chunkingConfig: { ...kb.config.chunkingConfig } })
        }
        set({ kb, kbLoading: false })
      } else {
        set({ kbLoading: false, kbError: json.error?.message ?? '获取知识库失败' })
      }
    } catch (err) {
      set({ kbLoading: false, kbError: String(err) })
    }
  },

  updateKBInfo: async (kbId: string, patch: { name?: string; description?: string }) => {
    set({ kbSaving: true, kbSaveError: null })
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (json.success && json.data?.knowledgeBase) {
        set({ kb: json.data.knowledgeBase as KnowledgeBaseDetail, kbSaving: false })
        invalidateCache(`rag-kb:${kbId}`)
        invalidateCache('knowledge-bases:')
        return true
      }
      set({ kbSaving: false, kbSaveError: json.error?.message ?? '保存失败' })
      return false
    } catch (err) {
      set({ kbSaving: false, kbSaveError: String(err) })
      return false
    }
  },

  fetchDocuments: async (kbId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) {
      set({ docsLoading: true, docsError: null })
    }
    try {
      const json = await swrFetch(`rag-docs:${kbId}`, () =>
        fetch(`/api/rag/knowledge-bases/${kbId}/documents`).then((r) => r.json())
      )
      if (json.success && json.data?.documents) {
        const newDocs = json.data.documents as DocumentInfo[]
        if (silent) {
          // 静默刷新：增量合并，保留已有文档，新增/更新后端返回的文档
          const prevDocs = get().documents
          const prevMap = new Map(prevDocs.map((d) => [d.id, d]))
          const prevIds = new Set(prevMap.keys())
          // 按 processedAt 降序排（最新在前）
          const merged = [...newDocs].sort((a, b) => {
            const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0
            const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0
            return tb - ta
          })
          set({ documents: merged })
          // 检测新完成的文档
          const newlyArrived = newDocs.filter((d) => !prevIds.has(d.id)).map((d) => d.id)
          if (newlyArrived.length > 0) {
            set((s) => ({ newDocIds: [...s.newDocIds, ...newlyArrived] }))
            setTimeout(() => {
              set((s) => ({ newDocIds: s.newDocIds.filter((id) => !newlyArrived.includes(id)) }))
            }, 6000)
          }
        } else {
          const prevIds = new Set(get().documents.map((d) => d.id))
          // 按 processedAt 降序排（最新在前）
          const sorted = [...newDocs].sort((a, b) => {
            const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0
            const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0
            return tb - ta
          })
          set({ documents: sorted, docsLoading: false })
          // 检测新完成的文档（仅在批处理中标记）
          if (get().batchProcessing) {
            const newlyArrived = newDocs.filter((d: DocumentInfo) => !prevIds.has(d.id)).map((d: DocumentInfo) => d.id)
            if (newlyArrived.length > 0) {
              set((s) => ({ newDocIds: [...s.newDocIds, ...newlyArrived] }))
              setTimeout(() => {
                set((s) => ({ newDocIds: s.newDocIds.filter((id) => !newlyArrived.includes(id)) }))
              }, 6000)
            }
          }
        }
        // 检查是否有 processing 文档，有则启动轮询
        get().checkProcessingDocs(kbId)
      } else {
        if (!silent) {
          set({ documents: [], docsLoading: false, docsError: json.error?.message ?? '获取文档列表失败' })
        }
      }
    } catch (err) {
      if (!silent) {
        set({ docsLoading: false, docsError: String(err) })
      }
    }
  },

  checkProcessingDocs: (kbId: string) => {
    const { documents } = get()
    const hasProcessing = documents.some(
      (d) => d.status === 'processing' || d.status === 'pending'
    )

    if (hasProcessing) {
      // 已有定时器则跳过
      if (docPollTimer) return

      const poll = async () => {
        // 清除缓存确保拿到最新数据
        invalidateCache(`rag-docs:${kbId}`)
        try {
          const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents`)
          const json = await res.json()
          if (json.success && json.data?.documents) {
            const docs = json.data.documents as DocumentInfo[]
            const oldIds = new Set(get().documents.map((d) => d.id))
            // 静默合并，按 processedAt 降序（最新在前）
            const merged = [...docs].sort((a, b) => {
              const ta = a.processedAt ? new Date(a.processedAt).getTime() : 0
              const tb = b.processedAt ? new Date(b.processedAt).getTime() : 0
              return tb - ta
            })
            set({ documents: merged })
            // 检测新完成的文档
            const newlyArrived = docs.filter((d) => !oldIds.has(d.id)).map((d) => d.id)
            if (newlyArrived.length > 0) {
              set((s) => ({ newDocIds: [...s.newDocIds, ...newlyArrived] }))
              setTimeout(() => {
                set((s) => ({ newDocIds: s.newDocIds.filter((id) => !newlyArrived.includes(id)) }))
              }, 6000)
            }

            // 如果批处理中且 workers 未活跃（刷新恢复阶段），更新进度
            const { batchProcessing, batchActiveFiles, batchTotal, stagedFiles } = get()
            if (batchProcessing) {
              if (batchActiveFiles.length === 0) {
                // 首次恢复：用后端 processing docs 填充 activeFiles
                const processingDocs = docs.filter(
                  (d: DocumentInfo) => d.status === 'processing' || d.status === 'pending'
                )
                if (processingDocs.length > 0) {
                  set({
                    batchActiveFiles: processingDocs.map((d) => ({
                      name: d.name,
                      progress: 0,
                      stage: 'processing' as const,
                    })),
                  })
                }
              } else {
                // 后续轮询：移除不再 processing 的文档（已完成或失败）
                const processingNames = new Set(
                  docs
                    .filter((d: DocumentInfo) => d.status === 'processing' || d.status === 'pending')
                    .map((d) => d.name)
                )
                const updatedActive = batchActiveFiles.filter((f) => processingNames.has(f.name))
                set({ batchActiveFiles: updatedActive })
              }

              const processingCount = docs.filter(
                (d: DocumentInfo) => d.status === 'processing' || d.status === 'pending'
              ).length
              const completed = batchTotal - stagedFiles.length - processingCount
              set({ batchCompletedCount: Math.max(0, completed) })
            }
          }
        } catch { /* ignore poll error */ }

        // 检查是否还有 processing 文档
        const stillProcessing = get().documents.some(
          (d) => d.status === 'processing' || d.status === 'pending'
        )

        if (stillProcessing) {
          docPollTimer = setTimeout(poll, 3000)
        } else {
          docPollTimer = null
          // 处理完成，刷新知识库统计
          invalidateCache(`rag-kb:${kbId}`)
          get().fetchKnowledgeBase(kbId)

          // 如果批处理中且有暂存文件待处理（刷新恢复场景），自动继续处理
          const { batchProcessing, stagedFiles } = get()
          if (batchProcessing && stagedFiles.length > 0 && !workersActive) {
            get().processStagedFiles(kbId, { alreadyCompleted: get().batchCompletedCount })
          }
        }
      }

      docPollTimer = setTimeout(poll, 3000)
    }
  },

  stopDocPolling: () => {
    if (docPollTimer) {
      clearTimeout(docPollTimer)
      docPollTimer = null
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

  fetchChunkPreview: async (kbId: string, file: File, chunkingConfig?: ChunkingConfig) => {
    set({ previewChunksLoading: true, previewChunksError: null, previewChunksFileName: file.name })
    try {
      const formData = new FormData()
      formData.append('file', file)
      const config = chunkingConfig || get().chunkingConfig
      if (config) {
        formData.append('chunkStrategy', config.strategy)
        formData.append('chunkSize', String(config.chunkSize))
        formData.append('chunkOverlap', String(config.overlap))
      }

      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/chunk-preview`, {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (json.success && json.data) {
        set({
          previewChunks: json.data.chunks || [],
          previewChunksLoading: false,
        })
      } else {
        set({ previewChunks: [], previewChunksLoading: false, previewChunksError: json.error?.message ?? '预览失败' })
      }
    } catch (err) {
      set({ previewChunksLoading: false, previewChunksError: String(err) })
    }
  },

  clearPreviewChunks: () => {
    set({ previewChunks: [], previewChunksError: null, previewChunksFileName: null })
  },

  uploadDocument: async (kbId: string, file: File, chunkingConfig?: ChunkingConfig) => {
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
      // 附加分块配置到表单字段
      const config = chunkingConfig || get().chunkingConfig
      if (config) {
        formData.append('chunkStrategy', config.strategy)
        formData.append('chunkSize', String(config.chunkSize))
        formData.append('chunkOverlap', String(config.overlap))
      }

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

  // ── 暂存区操作 ──────────────────────────────────────────

  addStagedFiles: (files: File[]) => {
    const staged: StagedFile[] = files.map((file) => {
      // webkitRelativePath 保留文件夹上传时的路径
      const relativePath = (file as any).webkitRelativePath || undefined
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        relativePath,
      }
    })
    set((s) => ({ stagedFiles: [...s.stagedFiles, ...staged] }))
    // 持久化到 IndexedDB（fire-and-forget）
    const kbId = get().currentKbId
    if (kbId) saveStagedFiles(kbId, get().stagedFiles).catch(() => {})
  },

  removeStagedFile: (id: string) => {
    set((s) => {
      const nextProgress = { ...s.stagedFileProgress }
      delete nextProgress[id]
      return {
        stagedFiles: s.stagedFiles.filter((f) => f.id !== id),
        stagedFileProgress: nextProgress,
      }
    })
    removeStagedFileById(id).catch(() => {})
  },

  removeStagedFileById: (id: string) => {
    set((s) => ({ stagedFiles: s.stagedFiles.filter((f) => f.id !== id) }))
    removeStagedFileById(id).catch(() => {})
  },

  clearStagedFiles: () => {
    set({ stagedFiles: [], stagedFileProgress: {} })
    const kbId = get().currentKbId
    if (kbId) clearAllForKb(kbId).catch(() => {})
  },

  updateChunkingConfig: (config: Partial<ChunkingConfig>) => {
    set((s) => ({ chunkingConfig: { ...s.chunkingConfig, ...config } }))
  },

  processStagedFiles: async (kbId: string, options?: { alreadyCompleted?: number }) => {
    // 防止重入：如果 workers 已在运行，直接返回
    if (workersActive) return

    const { stagedFiles, chunkingConfig } = get()
    if (stagedFiles.length === 0) return

    workersActive = true
    const alreadyCompleted = options?.alreadyCompleted ?? 0

    // 保存批处理元数据到 IndexedDB（用于刷新后恢复）
    await saveBatchMeta({
      kbId,
      processingStarted: true,
      totalFiles: stagedFiles.length + alreadyCompleted,
      concurrency: chunkingConfig.batchConcurrency || 1,
      chunkingConfig: { ...chunkingConfig },
      startedAt: new Date().toISOString(),
    }).catch(() => {})

    const concurrency = Math.max(1, Math.min(chunkingConfig.batchConcurrency || 1, 50, stagedFiles.length))

    // 初始化每个暂存文件的进度：pending 0%
    const initialProgress: Record<string, StagedFileProgress> = {}
    for (const sf of stagedFiles) {
      initialProgress[sf.id] = { stage: 'pending', progress: 0 }
    }

    set({
      batchProcessing: true,
      batchTotal: stagedFiles.length + alreadyCompleted,
      batchCompletedCount: alreadyCompleted,
      batchActiveFiles: [],
      batchErrors: [],
      batchDone: false,
      stagedFileProgress: initialProgress,
    })

    const errors: string[] = []
    let completedCount = alreadyCompleted
    let nextIndex = 0

    // 更新指定暂存文件进度
    const setProgress = (id: string, patch: Partial<StagedFileProgress>) => {
      set((s) => {
        const current = s.stagedFileProgress[id]
        if (!current) return s
        return {
          stagedFileProgress: {
            ...s.stagedFileProgress,
            [id]: { ...current, ...patch },
          },
        }
      })
    }

    const updateActiveFile = (name: string, progress: number, stage: string | null) => {
      const current = get().batchActiveFiles
      const idx = current.findIndex((f) => f.name === name)
      if (idx >= 0) {
        const updated = [...current]
        updated[idx] = { name, progress, stage }
        set({ batchActiveFiles: updated })
      }
    }

    const removeActiveFile = (name: string) => {
      const current = get().batchActiveFiles
      set({ batchActiveFiles: current.filter((f) => f.name !== name) })
    }

    // 处理单个文件的 worker：完成一个立即从队列取下一个（流水线并发）
    const processOne = async () => {
      while (nextIndex < stagedFiles.length) {
        const myIndex = nextIndex++
        const sf = stagedFiles[myIndex]

        // 标记为上传中，记录开始时间，并加入 active 列表
        setProgress(sf.id, { stage: 'uploading', progress: 0, startTime: Date.now() })
        set((s) => ({ batchActiveFiles: [...s.batchActiveFiles, { name: sf.name, progress: 0, stage: 'uploading' }] }))

        try {
          const formData = new FormData()
          formData.append('file', sf.file)
          formData.append('chunkStrategy', chunkingConfig.strategy)
          formData.append('chunkSize', String(chunkingConfig.chunkSize))
          formData.append('chunkOverlap', String(chunkingConfig.overlap))

          const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents?stream=progress`, {
            method: 'POST',
            body: formData,
          })

          if (!res.ok) {
            const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
            const message = json.error?.message ?? '上传失败'
            console.error(`[RAG Batch] 文件上传 HTTP 错误 [文件=${sf.name}]: ${message}`)
            errors.push(`${sf.name}: ${message}`)
            setProgress(sf.id, { stage: 'error', progress: 0, error: message, endTime: Date.now() })
            removeActiveFile(sf.name)
            completedCount++
            set({ batchCompletedCount: completedCount })
            continue
          }

          const reader = res.body?.getReader()
          if (!reader) {
            console.error(`[RAG Batch] 无法读取响应流 [文件=${sf.name}]`)
            errors.push(`${sf.name}: 无法读取响应流`)
            setProgress(sf.id, { stage: 'error', progress: 0, error: '无法读取响应流', endTime: Date.now() })
            removeActiveFile(sf.name)
            completedCount++
            set({ batchCompletedCount: completedCount })
            continue
          }

          const decoder = new TextDecoder()
          let buffer = ''
          let fileDone = false

          while (!fileDone) {
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
                  case 'progress': {
                    const stage = (event.stage as StagedFileProgress['stage']) || 'processing'
                    setProgress(sf.id, { stage, progress: event.progress })
                    updateActiveFile(sf.name, event.progress, event.stage)
                    break
                  }
                  case 'done': {
                    fileDone = true
                    setProgress(sf.id, { stage: 'done', progress: 100, endTime: Date.now() })
                    updateActiveFile(sf.name, 100, 'done')
                    break
                  }
                  case 'error': {
                    fileDone = true
                    const message = event.error ?? '处理失败'
                    console.error(`[RAG Batch] 服务端处理错误 [文件=${sf.name}]: ${message}`)
                    errors.push(`${sf.name}: ${message}`)
                    setProgress(sf.id, { stage: 'error', progress: 0, error: message, endTime: Date.now() })
                    break
                  }
                }
              } catch {
                // 忽略无法解析的行
              }
            }
          }
        } catch (err) {
          const message = String(err)
          console.error(`[RAG Batch] 文件处理异常 [文件=${sf.name}]:`, err)
          errors.push(`${sf.name}: ${message}`)
          setProgress(sf.id, { stage: 'error', progress: 0, error: message, endTime: Date.now() })
        }

        removeActiveFile(sf.name)
        completedCount++
        set({ batchCompletedCount: completedCount })
        // 每个文件完成后静默刷新文档列表，增量合并不闪烁
        invalidateCache(`rag-docs:${kbId}`)
        get().fetchDocuments(kbId, { silent: true })
      }
    }

    // 启动 N 个 worker 并发处理
    await Promise.all(
      Array.from({ length: concurrency }, () => processOne())
    )

    // 刷新列表和知识库信息
    invalidateCache(`rag-docs:${kbId}`)
    invalidateCache(`rag-kb:${kbId}`)
    await get().fetchDocuments(kbId, { silent: true })
    await get().fetchKnowledgeBase(kbId)

    set({
      batchProcessing: false,
      batchDone: true,
      batchErrors: errors,
      stagedFiles: [],
      batchActiveFiles: [],
      stagedFileProgress: {},
    })

    workersActive = false

    // 批处理结果日志
    if (errors.length > 0) {
      console.warn(`[RAG Batch] 批量处理完成: ${stagedFiles.length + alreadyCompleted} 个文件, ${errors.length} 个失败`, errors)
    } else {
      console.log(`[RAG Batch] 批量处理全部成功: ${stagedFiles.length + alreadyCompleted} 个文件`)
    }

    // 清除 IndexedDB 中的批处理数据
    await clearAllForKb(kbId).catch(() => {})

    // 短暂展示完成后清理
    setTimeout(() => {
      set({ batchDone: false })
    }, 2000)
  },

  /** 刷新页面后恢复未完成的批处理会话 */
  restoreBatchSession: async (kbId: string) => {
    try {
      const meta = await loadBatchMeta(kbId)

      // 没有批处理元数据 —— 可能只有暂存文件（用户还没点执行）
      if (!meta || !meta.processingStarted) {
        const persistedFiles = await loadStagedFiles(kbId)
        if (persistedFiles.length > 0) {
          set({
            stagedFiles: persistedFiles.map((f) => ({
              id: f.id,
              file: f.file,
              name: f.name,
              size: f.size,
              type: f.type,
              relativePath: f.relativePath,
            })),
            chunkingConfig: meta?.chunkingConfig ?? get().chunkingConfig,
          })
        }
        return
      }

      // 有批处理元数据 —— 需要恢复处理
      const persistedFiles = await loadStagedFiles(kbId)
      if (persistedFiles.length === 0) {
        // IndexedDB 中没有文件，清除元数据
        await clearAllForKb(kbId).catch(() => {})
        return
      }

      // 同步 chunkingConfig
      set({ chunkingConfig: { ...meta.chunkingConfig } })

      // 获取后端文档列表，判断哪些文件已在处理中
      invalidateCache(`rag-docs:${kbId}`)
      let backendDocs: DocumentInfo[] = []
      try {
        const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents`)
        const json = await res.json()
        if (json.success && json.data?.documents) {
          backendDocs = json.data.documents
          set({ documents: backendDocs })
        }
      } catch { /* ignore */ }

      // 用 name+size 匹配，过滤掉已在后端的文件
      // processing/pending = 正在处理中，ready = 已完成 → 从队列移除
      // error = 失败，保留在队列中以便重试
      const backendFileKeys = new Set(
        backendDocs
          .filter((d) => d.status === 'processing' || d.status === 'ready' || d.status === 'pending')
          .map((d) => `${d.name}::${d.size}`)
      )

      const remainingFiles = persistedFiles.filter(
        (f) => !backendFileKeys.has(`${f.name}::${f.size}`)
      )

      const processingDocs = backendDocs.filter((d) => d.status === 'processing' || d.status === 'pending')
      
      // 仅统计属于此批次的已就绪文档
      const batchFileKeys = new Set(persistedFiles.map((f) => `${f.name}::${f.size}`))
      const readyCount = backendDocs.filter(
        (d) => d.status === 'ready' && batchFileKeys.has(`${d.name}::${d.size}`)
      ).length

      // 恢复暂存文件，同时初始化进度（pending = 尚未开始处理）
      const restoredProgress: Record<string, StagedFileProgress> = {}
      for (const f of remainingFiles) {
        restoredProgress[f.id] = { stage: 'pending', progress: 0 }
      }
      set({
        stagedFiles: remainingFiles.map((f) => ({
          id: f.id,
          file: f.file,
          name: f.name,
          size: f.size,
          type: f.type,
          relativePath: f.relativePath,
        })),
        stagedFileProgress: restoredProgress,
        batchProcessing: true,
        batchTotal: meta.totalFiles,
        batchCompletedCount: readyCount,
        batchActiveFiles: [],
        batchErrors: [],
        batchDone: false,
      })

      // 如果有正在处理的文档，等待它们完成（轮询会自动处理）
      if (processingDocs.length > 0) {
        // 填充正在处理的文件列表到 batchActiveFiles，让 UI 能看到进度
        set({
          batchActiveFiles: processingDocs.map((d) => ({
            name: d.name,
            progress: 0, // 未知进度
            stage: 'processing' as const,
          })),
        })
        get().checkProcessingDocs(kbId)
      } else if (remainingFiles.length > 0) {
        // 没有正在处理的文档，直接继续处理剩余文件
        get().processStagedFiles(kbId, { alreadyCompleted: readyCount })
      } else {
        // 所有文件都已处理完成
        set({ batchProcessing: false, batchDone: true, stagedFiles: [], batchActiveFiles: [] })
        await clearAllForKb(kbId).catch(() => {})
        setTimeout(() => set({ batchDone: false }), 2000)
      }
    } catch {
      // 恢复失败，静默处理
    }
  },

  /** 检测向量模型是否可用（处理前校验） */
  checkEmbeddingHealth: async (kbId: string) => {
    set({ embeddingChecking: true, embeddingCheckResult: null })
    try {
      const res = await fetch(`/api/rag/knowledge-bases/${kbId}/embedding-check`)
      const json = await res.json()
      const result = json.success ? json.data : { available: false, error: json.error || '检测失败' }
      set({ embeddingCheckResult: result, embeddingChecking: false })
      return result.available === true
    } catch (err) {
      set({
        embeddingChecking: false,
        embeddingCheckResult: { available: false, error: String(err) },
      })
      return false
    }
  },

  reset: () => {
    // 停止轮询定时器
    if (docPollTimer) {
      clearTimeout(docPollTimer)
      docPollTimer = null
    }
    workersActive = false
    set(initialState)
  },
}))
