/* RAG 详情页 Zustand Store —— 知识库详情、文档、检索、配置 */

import { create } from 'zustand'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'
import {
  saveStagedFiles,
  loadStagedFiles,
  removeStagedFileById,
  removeStagedFilesById,
  clearAllForKb,
  saveBatchMeta,
  loadBatchMeta,
  clearBatchMeta,
} from '@/stores/lib/staged-files-db'

// ── 文档列表轮询定时器（有 processing 文档时自动刷新）─────────
let docPollTimer: ReturnType<typeof setTimeout> | null = null

/** 当前知识库仍在写入 canonical staging 的任务。批处理必须等它完成。 */
const stagingWrites = new Map<string, Promise<void>>()
export const MAX_RAG_BATCH_CONCURRENCY = 5

function normalizeBatchConcurrency(value: number | undefined): number {
  const requested = Number.isFinite(value) ? Math.trunc(value!) : 1
  return Math.max(1, Math.min(requested, MAX_RAG_BATCH_CONCURRENCY))
}

interface DurableJobSnapshot {
  id: string
  status: 'queued' | 'running' | 'waiting_for_input' | 'retry_scheduled' | 'recovery_required' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
  progress?: number
  checkpoint?: string
  error?: { message?: string }
  result?: { chunkCount?: number }
}

function stageFromCheckpoint(checkpoint?: string): StagedFileProgress['stage'] {
  switch (checkpoint) {
    case 'accepted': return 'uploading'
    case 'parsed': return 'parsing'
    case 'chunked': return 'chunking'
    case 'embedded': return 'embedding'
    case 'indexed': return 'storing'
    case 'catalog_committed': return 'done'
    default: return 'pending'
  }
}

async function submitDurableRagJob(kbId: string, file: File, config: ChunkingConfig, idempotencySeed: string): Promise<DurableJobSnapshot> {
  const sha256 = await sha256Hex(await file.arrayBuffer())
  const uploadKey = `upload:${kbId}:${idempotencySeed}`
  const created = await fetch(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/upload-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': uploadKey },
    body: JSON.stringify({ name: file.name, mediaType: file.type || 'application/octet-stream', size: file.size, sha256 }),
  })
  const createdBody = await created.json()
  if (!created.ok) throw new Error(createdBody.error?.message ?? `上传会话创建失败 (${created.status})`)
  const session = createdBody.data as { id: string; status: 'uploading' | 'completed'; partSize: number; partCount: number; receivedParts: Array<{ number: number }> }
  if (session.status !== 'completed') {
    const received = new Set(session.receivedParts.map((part) => part.number))
    for (let number = 0; number < session.partCount; number++) {
      if (received.has(number)) continue
      const part = file.slice(number * session.partSize, Math.min(file.size, (number + 1) * session.partSize))
      const partSha256 = await sha256Hex(await part.arrayBuffer())
      const uploaded = await fetch(`/v1/upload-sessions/${encodeURIComponent(session.id)}/parts/${number}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Part-Sha256': partSha256 },
        body: part,
      })
      if (!uploaded.ok) {
        const body = await uploaded.json().catch(() => ({}))
        throw new Error(body.error?.message ?? `分块 ${number} 上传失败 (${uploaded.status})`)
      }
    }
  }
  const completed = await fetch(`/v1/upload-sessions/${encodeURIComponent(session.id)}/complete`, { method: 'POST' })
  const completedBody = await completed.json()
  if (!completed.ok) throw new Error(completedBody.error?.message ?? `上传完成失败 (${completed.status})`)
  const submitted = await fetch(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `ingest:${kbId}:${idempotencySeed}` },
    body: JSON.stringify({
      assetId: completedBody.data.asset.assetId,
      chunkStrategy: config.strategy,
      chunkSize: config.chunkSize,
      chunkOverlap: config.overlap,
    }),
  })
  const submitBody = await submitted.json()
  if (!submitted.ok) throw new Error(submitBody.error?.message ?? `任务提交失败 (${submitted.status})`)
  return submitBody.data as DurableJobSnapshot
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function waitForDurableJob(jobId: string, onSnapshot: (job: DurableJobSnapshot) => void): Promise<DurableJobSnapshot> {
  while (true) {
    const response = await fetch(`/v1/jobs/${encodeURIComponent(jobId)}`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message ?? `任务状态读取失败 (${response.status})`)
    const job = body.data as DurableJobSnapshot
    onSnapshot(job)
    if (['succeeded', 'failed', 'cancelled', 'recovery_required'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 知识库详情 */
export interface KnowledgeBaseDetail {
  id: string
  name: string
  description: string
  providerId: string
  directory: string[]
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

function applyCanonicalStagedFiles(
  current: StagedFile[],
  uploaded: StagedFile[],
  persisted: Awaited<ReturnType<typeof saveStagedFiles>>,
): StagedFile[] {
  const byLocalId = new Map(uploaded.map((file, index) => [file.id, persisted[index]]))
  const canonical = current.map((file) => {
    const remote = byLocalId.get(file.id)
    return remote ? { ...file, id: remote.id, name: remote.name, size: remote.size, type: remote.type } : file
  })
  return [...new Map(canonical.map((file) => [file.id, file])).values()]
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
  deprecated?: boolean
}

/** Embedding Provider */
export interface EmbeddingProviderOption {
  id: 'openai' | 'local'
  name: string
  source: 'catalog' | 'discovered'
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
  sourceSha256?: string
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
  modelType: 'chat' | 'reasoning' | 'embedding' | 'multimodal'
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
      const config = chunkingConfig || get().chunkingConfig
      const submitted = await submitDurableRagJob(kbId, file, config, `${file.name}:${file.size}:${file.lastModified}`)
      const completed = await waitForDurableJob(submitted.id, (job) => {
        set({
          uploadStage: job.checkpoint ?? job.status,
          uploadProgress: Math.round((job.progress ?? 0) * 100),
          uploadMessage: job.checkpoint ? `后台任务：${job.checkpoint}` : `后台任务：${job.status}`,
        })
      })
      if (completed.status !== 'succeeded') {
        set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadError: completed.error?.message ?? `任务状态：${completed.status}` })
        return false
      }
      set({ uploadProgress: 100, uploadStage: 'done', uploadMessage: `处理完成，共 ${completed.result?.chunkCount ?? 0} 个分块`, uploadChunkCount: completed.result?.chunkCount ?? null })
      await new Promise((resolve) => setTimeout(resolve, 600))
      set({ uploadProgress: null, uploadStage: null, uploadMessage: null, uploadChunkCount: null })
      invalidateCache(`rag-docs:${kbId}`); invalidateCache(`rag-kb:${kbId}`)
      await get().fetchDocuments(kbId); await get().fetchKnowledgeBase(kbId)
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
    // File bytes become recoverable only after the cache API acknowledges
    // them.  On offline failure they remain visibly local and are retried by
    // the next add/process action; no browser durable store is claimed.
    if (kbId) {
      const previousWrite = stagingWrites.get(kbId) ?? Promise.resolve()
      const write = previousWrite.catch(() => {}).then(() => saveStagedFiles(kbId, staged)).then((persisted) => {
        set((state) => {
          return { stagedFiles: applyCanonicalStagedFiles(state.stagedFiles, staged, persisted) }
        })
      })
      stagingWrites.set(kbId, write)
      void write.catch((error) => console.warn('[RAG Batch] staged cache upload retained for retry', error))
      void write.then(
        () => { if (stagingWrites.get(kbId) === write) stagingWrites.delete(kbId) },
        () => { if (stagingWrites.get(kbId) === write) stagingWrites.delete(kbId) },
      )
    }
  },

  removeStagedFile: (id: string) => {
    void removeStagedFileById(id, get().currentKbId ?? undefined).then(() => {
      set((s) => {
        const nextProgress = { ...s.stagedFileProgress }
        delete nextProgress[id]
        return { stagedFiles: s.stagedFiles.filter((f) => f.id !== id), stagedFileProgress: nextProgress }
      })
    }).catch((error: unknown) => {
      console.warn('[RAG Batch] staged cache delete retained for retry', error)
      set((s) => ({ stagedFileProgress: { ...s.stagedFileProgress, [id]: { ...s.stagedFileProgress[id], stage: 'error', progress: s.stagedFileProgress[id]?.progress ?? 0, error: error instanceof Error ? error.message : 'Unable to remove staged file' } } }))
    })
  },

  removeStagedFileById: (id: string) => {
    void removeStagedFileById(id, get().currentKbId ?? undefined).then(() => {
      set((s) => ({ stagedFiles: s.stagedFiles.filter((f) => f.id !== id) }))
    }).catch((error: unknown) => {
      console.warn('[RAG Batch] staged cache delete retained for retry', error)
      set((s) => ({ stagedFileProgress: { ...s.stagedFileProgress, [id]: { ...s.stagedFileProgress[id], stage: 'error', progress: s.stagedFileProgress[id]?.progress ?? 0, error: error instanceof Error ? error.message : 'Unable to remove staged file' } } }))
    })
  },

  clearStagedFiles: () => {
    const kbId = get().currentKbId
    const staged = get().stagedFiles
    if (!kbId) { set({ stagedFiles: [], stagedFileProgress: {} }); return }
    void removeStagedFilesById(kbId, staged.map((file) => file.id)).then(async ({ deletedIds, failures }) => {
      const deleted = new Set(deletedIds)
      const failureById = new Map(failures.map((failure) => [failure.id, failure.error]))
      set((state) => {
        const progress = { ...state.stagedFileProgress }
        for (const id of deleted) delete progress[id]
        for (const [id, error] of failureById) progress[id] = { ...progress[id], stage: 'error', progress: progress[id]?.progress ?? 0, error: error.message }
        return { stagedFiles: state.stagedFiles.filter((file) => !deleted.has(file.id)), stagedFileProgress: progress }
      })
      if (failures.length === 0) { await clearBatchMeta(kbId); return }
      // Acknowledge partial success before reloading. Merge only retained rows
      // so a server reload cannot resurrect an acknowledged deletion.
      try {
        const persisted = await loadStagedFiles(kbId)
        set((state) => {
          const current = new Map(state.stagedFiles.map((file) => [file.id, file]))
          for (const file of persisted) if (!deleted.has(file.id)) current.set(file.id, { id: file.id, file: file.file, name: file.name, size: file.size, type: file.type, relativePath: file.relativePath })
          return { stagedFiles: [...current.values()] }
        })
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to reload staged files'
        set((state) => ({ stagedFileProgress: Object.fromEntries(Object.entries(state.stagedFileProgress).map(([id, progress]) => failureById.has(id) ? [id, { ...progress, stage: 'error', error: message }] : [id, progress])) }))
      }
    })
  },

  updateChunkingConfig: (config: Partial<ChunkingConfig>) => {
    set((s) => ({
      chunkingConfig: {
        ...s.chunkingConfig,
        ...config,
        ...(config.batchConcurrency === undefined ? {} : { batchConcurrency: normalizeBatchConcurrency(config.batchConcurrency) }),
      },
    }))
  },

  processStagedFiles: async (kbId: string, options?: { alreadyCompleted?: number }) => {
    await stagingWrites.get(kbId)?.catch(() => {})
    const files = [...get().stagedFiles]
    if (!files.length) return
    const config = get().chunkingConfig
    const alreadyCompleted = options?.alreadyCompleted ?? 0
    set({
      batchProcessing: true,
      batchTotal: files.length + alreadyCompleted,
      batchCompletedCount: alreadyCompleted,
      batchActiveFiles: [],
      batchErrors: [],
      batchDone: false,
      stagedFileProgress: Object.fromEntries(files.map((file) => [file.id, { stage: 'pending', progress: 0 }])),
    })
    await saveBatchMeta({ kbId, processingStarted: true, totalFiles: files.length + alreadyCompleted, concurrency: 1, chunkingConfig: config, startedAt: new Date().toISOString() }).catch(() => {})
    const submissions: Array<{ file: StagedFile; job: DurableJobSnapshot }> = []
    const submissionErrors: string[] = []
    for (const file of files) {
      set((state) => ({ stagedFileProgress: { ...state.stagedFileProgress, [file.id]: { stage: 'uploading', progress: 0, startTime: Date.now() } }, batchActiveFiles: [...state.batchActiveFiles, { name: file.name, progress: 0, stage: 'uploading' }] }))
      try {
        const job = await submitDurableRagJob(kbId, file.file, config, file.id)
        submissions.push({ file, job })
        await removeStagedFileById(file.id, kbId).catch(() => undefined)
        set((state) => ({ stagedFiles: state.stagedFiles.filter((item) => item.id !== file.id), stagedFileProgress: { ...state.stagedFileProgress, [file.id]: { stage: 'pending', progress: 0, startTime: Date.now() } } }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        submissionErrors.push(`${file.name}: ${message}`)
        set((state) => ({ stagedFileProgress: { ...state.stagedFileProgress, [file.id]: { stage: 'error', progress: 0, error: message, endTime: Date.now() } }, batchActiveFiles: state.batchActiveFiles.filter((item) => item.name !== file.name) }))
      }
    }
    const outcomes = await Promise.all(submissions.map(async ({ file, job }) => {
      const completed = await waitForDurableJob(job.id, (snapshot) => {
        const progress = Math.round((snapshot.progress ?? 0) * 100)
        set((state) => ({
          stagedFileProgress: { ...state.stagedFileProgress, [file.id]: { stage: snapshot.status === 'succeeded' ? 'done' : snapshot.status === 'failed' || snapshot.status === 'cancelled' || snapshot.status === 'recovery_required' ? 'error' : stageFromCheckpoint(snapshot.checkpoint), progress, error: snapshot.error?.message } },
          batchActiveFiles: state.batchActiveFiles.map((item) => item.name === file.name ? { name: file.name, progress, stage: snapshot.checkpoint ?? snapshot.status } : item),
        }))
      })
      return { file, completed }
    }))
    const executionErrors = outcomes.filter(({ completed }) => completed.status !== 'succeeded').map(({ file, completed }) => `${file.name}: ${completed.error?.message ?? completed.status}`)
    const errors = [...submissionErrors, ...executionErrors]
    invalidateCache(`rag-docs:${kbId}`); invalidateCache(`rag-kb:${kbId}`)
    await get().fetchDocuments(kbId, { silent: true }); await get().fetchKnowledgeBase(kbId)
    set({ batchProcessing: false, batchDone: true, batchCompletedCount: alreadyCompleted + outcomes.length, batchActiveFiles: [], batchErrors: errors, stagedFileProgress: Object.fromEntries(Object.entries(get().stagedFileProgress).filter(([id]) => get().stagedFiles.some((file) => file.id === id))) })
    if (!errors.length) { await clearAllForKb(kbId).catch(() => undefined); setTimeout(() => set({ batchDone: false }), 2000) }
  },

  /** 刷新页面后恢复未完成的批处理会话 */
  restoreBatchSession: async (kbId: string) => {
    try {
      const meta = await loadBatchMeta(kbId)

      // 没有批处理元数据 —— 可能只有暂存文件（用户还没点执行）
      if (!meta || !meta.processingStarted) {
        const persistedFiles = await loadStagedFiles(kbId)
        const completedHashes = new Set(
          get().documents
            .filter((document) => document.status === 'ready' && document.sourceSha256)
            .map((document) => document.sourceSha256!),
        )
        const completedIds = persistedFiles.filter((file) => completedHashes.has(file.id)).map((file) => file.id)
        const pendingFiles = persistedFiles.filter((file) => !completedHashes.has(file.id))
        if (completedIds.length > 0) {
          const removed = await removeStagedFilesById(kbId, completedIds)
          if (removed.failures.length > 0) console.warn('[RAG Batch] completed staged cache cleanup retained for retry', removed.failures)
        }
        if (pendingFiles.length > 0) {
          set({
            stagedFiles: pendingFiles.map((f) => ({
              id: f.id,
              file: f.file,
              name: f.name,
              size: f.size,
              type: f.type,
              relativePath: f.relativePath,
            })),
            chunkingConfig: meta?.chunkingConfig ?? get().chunkingConfig,
          })
        } else {
          set({ stagedFiles: [], stagedFileProgress: {} })
        }
        return
      }

      // 有批处理元数据 —— 需要恢复处理
      const persistedFiles = await loadStagedFiles(kbId)
      if (persistedFiles.length === 0) {
        // IndexedDB 中没有文件，清除元数据
        await clearAllForKb(kbId).catch((error: unknown) => console.warn('[RAG Batch] staged cache clear retained for retry', error))
        return
      }

      // 同步 chunkingConfig
      set({ chunkingConfig: { ...meta.chunkingConfig, batchConcurrency: normalizeBatchConcurrency(meta.chunkingConfig.batchConcurrency) } })

      // 获取后端文档列表，判断哪些文件已在处理中
      invalidateCache(`rag-docs:${kbId}`)
      let backendDocs: DocumentInfo[] = []
      try {
        const res = await fetch(`/api/rag/knowledge-bases/${kbId}/documents`)
        const json = await res.json()
        if (!res.ok || !json.success || !Array.isArray(json.data?.documents)) {
          throw new Error(json.error?.message ?? `HTTP ${res.status}`)
        }
        backendDocs = json.data.documents
        set({ documents: backendDocs, docsError: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : '文档状态读取失败'
        set({
          stagedFiles: persistedFiles.map((file) => ({ id: file.id, file: file.file, name: file.name, size: file.size, type: file.type, relativePath: file.relativePath })),
          stagedFileProgress: Object.fromEntries(persistedFiles.map((file) => [file.id, { stage: 'error' as const, progress: 0, error: `无法确认后端状态: ${message}` }])),
          batchProcessing: false,
          batchTotal: meta.totalFiles,
          batchActiveFiles: [],
          batchErrors: [`恢复已暂停: ${message}`],
          batchDone: true,
          docsError: `无法读取文档状态，已停止自动重试: ${message}`,
        })
        return
      }

      // canonical staging ID 就是 sourceSha256。文件名会在 staging 层被安全化，
      // 因此 name+size 只能作为旧数据 fallback，不能作为主匹配键。
      const batchFileKeys = new Set(persistedFiles.map((f) => `${f.name}::${f.size}`))
      const readyHashes = new Set(backendDocs.filter((d) => d.status === 'ready' && d.sourceSha256).map((d) => d.sourceSha256!))
      const activeHashes = new Set(backendDocs.filter((d) => (d.status === 'processing' || d.status === 'pending') && d.sourceSha256).map((d) => d.sourceSha256!))
      const legacyReadyKeys = new Set(backendDocs.filter((d) => d.status === 'ready' && !d.sourceSha256).map((d) => `${d.name}::${d.size}`))
      const legacyActiveKeys = new Set(backendDocs.filter((d) => (d.status === 'processing' || d.status === 'pending') && !d.sourceSha256).map((d) => `${d.name}::${d.size}`))
      const isReady = (file: typeof persistedFiles[number]) => readyHashes.has(file.id) || legacyReadyKeys.has(`${file.name}::${file.size}`)
      const isActive = (file: typeof persistedFiles[number]) => activeHashes.has(file.id) || legacyActiveKeys.has(`${file.name}::${file.size}`)
      const completedIds = persistedFiles.filter(isReady).map((file) => file.id)
      const remainingFiles = persistedFiles.filter((file) => !isReady(file) && !isActive(file))
      const readyCount = persistedFiles.filter(isReady).length
      if (completedIds.length > 0) {
        const removed = await removeStagedFilesById(kbId, completedIds)
        if (removed.failures.length > 0) console.warn('[RAG Batch] completed staged cache cleanup retained for retry', removed.failures)
      }

      const processingDocs = backendDocs.filter((document) => {
        if (document.status !== 'processing' && document.status !== 'pending') return false
        return document.sourceSha256
          ? activeHashes.has(document.sourceSha256) && persistedFiles.some((file) => file.id === document.sourceSha256)
          : batchFileKeys.has(`${document.name}::${document.size}`)
      })

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
        await clearAllForKb(kbId).catch((error: unknown) => console.warn('[RAG Batch] staged cache clear retained for retry', error))
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
    set(initialState)
  },
}))
