/**
 * RAG (Retrieval-Augmented Generation) 类型定义
 */

/** 文档元数据 */
export interface DocumentMetadata {
  id: string
  name: string
  type: string // 'pdf', 'txt', 'md', 'html', etc.
  size: number
  uploadedAt: string
  processedAt?: string
  chunkCount?: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  error?: string
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

/** RAG Provider 接口 */
export interface RAGProvider {
  /** Provider 唯一标识 */
  readonly id: string
  /** Provider 名称 */
  readonly name: string

  /** 初始化 Provider */
  initialize(): Promise<void>

  /** 创建知识库 */
  createKnowledgeBase(id: string, name: string, config?: KnowledgeBaseConfig): Promise<void>

  /** 删除知识库 */
  deleteKnowledgeBase(id: string): Promise<void>

  /** 添加文档到知识库 */
  addDocument(knowledgeBaseId: string, document: DocumentMetadata, chunks: DocumentChunk[]): Promise<void>

  /** 删除文档 */
  removeDocument(knowledgeBaseId: string, documentId: string): Promise<void>

  /** 检索相关文档块 */
  search(knowledgeBaseId: string, query: string, options?: SearchOptions): Promise<RetrievalResult[]>

  /** 获取知识库统计信息 */
  getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats>
}

/** 知识库配置 */
export interface KnowledgeBaseConfig {
  /** 向量维度 */
  dimensions?: number
  /** 相似度阈值 */
  similarityThreshold?: number
  /** 检索数量 */
  topK?: number
  /** 混合检索权重 */
  hybridSearch?: {
    enabled: boolean
    vectorWeight: number
    keywordWeight: number
  }
}

/** 检索选项 */
export interface SearchOptions {
  /** 返回结果数量 */
  topK?: number
  /** 相似度阈值 */
  threshold?: number
  /** 过滤条件 */
  filter?: Record<string, unknown>
  /** 是否包含元数据 */
  includeMetadata?: boolean
}

/** 知识库统计信息 */
export interface KnowledgeBaseStats {
  documentCount: number
  chunkCount: number
  totalSize: number
  lastUpdated?: string
}

/** Embedding 服务接口 */
export interface EmbeddingService {
  /** 生成文本嵌入 */
  embed(text: string): Promise<number[]>
  /** 批量生成嵌入 */
  embedBatch(texts: string[]): Promise<number[][]>
  /** 获取向量维度 */
  getDimensions(): number
}

/** 文档解析器接口 */
export interface DocumentParser {
  /** 支持的 MIME 类型 */
  supportedTypes: string[]
  /** 解析文档为文本块 */
  parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]>
}

/** 分块策略接口 */
export interface ChunkingStrategy {
  /** 将文本分割为块 */
  chunk(text: string, options?: ChunkingOptions): string[]
}

/** 分块选项 */
export interface ChunkingOptions {
  /** 块大小（字符数） */
  chunkSize?: number
  /** 重叠字符数 */
  overlap?: number
  /** 分隔符 */
  separators?: string[]
}