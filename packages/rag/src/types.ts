/**
 * RAG 核心类型定义 — 数据库读写、文档切分、检索
 */

/** 文档元数据 */
export interface DocumentMetadata {
  id: string
  name: string
  type: string
  size: number
  uploadedAt: string
  processedAt?: string
  chunkCount?: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  error?: string
  /** Path relative to the knowledge group root for the persisted original. */
  sourcePath?: string
  sourceSha256?: string
}

/** 文档块 */
export interface DocumentChunk {
  id: string
  documentId: string
  content: string
  metadata: Record<string, unknown>
  embedding?: number[]
  startIndex?: number
  endIndex?: number
}

/** 检索结果 */
export interface RetrievalResult {
  chunk: DocumentChunk
  score: number
  metadata: Record<string, unknown>
}

/** RAG Provider 接口 — 核心存储 + 检索 */
export interface RAGProvider {
  readonly id: string
  readonly name: string
  initialize(): Promise<void>
  createKnowledgeBase(id: string, name: string, config?: KnowledgeBaseConfig): Promise<void>
  deleteKnowledgeBase(id: string): Promise<void>
  addDocument(knowledgeBaseId: string, document: DocumentMetadata, chunks: DocumentChunk[]): Promise<void>
  removeDocument(knowledgeBaseId: string, documentId: string): Promise<void>
  /** 关键词检索 */
  search(knowledgeBaseId: string, query: string, options?: SearchOptions): Promise<RetrievalResult[]>
  getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats>
  checkpoint(): Promise<void>
  integrityCheck(): Promise<{ ok: boolean; error?: string }>
  close(): Promise<void>
  reopen(storageDir: string): Promise<void>
}

/** 知识库配置（仅含存储/检索参数，不含 embedding） */
export interface KnowledgeBaseConfig {
  dimensions?: number
  similarityThreshold?: number
  topK?: number
  hybridSearch?: {
    enabled: boolean
    vectorWeight: number
    keywordWeight: number
  }
}

/** 检索选项 */
export interface SearchOptions {
  topK?: number
  threshold?: number
  filter?: Record<string, unknown>
  includeMetadata?: boolean
}

/** 知识库统计 */
export interface KnowledgeBaseStats {
  documentCount: number
  chunkCount: number
  totalSize: number
  lastUpdated?: string
}

/** 分块策略接口 */
export interface ChunkingStrategy {
  chunk(text: string, options?: ChunkingOptions): string[]
}

/** 分块选项 */
export interface ChunkingOptions {
  chunkSize?: number
  overlap?: number
  separators?: string[]
}

/** Embedding 服务接口（调用方实现，模型配置由外部传入） */
export interface EmbeddingService {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  getDimensions(): number
}

/** 文档解析器接口 */
export interface DocumentParser {
  supportedTypes: string[]
  parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]>
}
