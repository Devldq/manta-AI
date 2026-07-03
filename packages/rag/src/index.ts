/**
 * @manta/rag — 核心 RAG 引擎
 *
 * 数据库读写（SQLite 向量库）、文档解析、文档切分、检索
 * Embedding 模型配置、API 路由等由调用方负责
 */

// ─── 类型 ───────────────────────────────────────────────
export type {
  DocumentMetadata,
  DocumentChunk,
  RetrievalResult,
  RAGProvider,
  KnowledgeBaseConfig,
  SearchOptions,
  KnowledgeBaseStats,
  EmbeddingService,
  DocumentParser,
  ChunkingStrategy,
  ChunkingOptions,
} from './types'

// ─── 分块策略 ───────────────────────────────────────────
export {
  FixedSizeChunkingStrategy,
  SemanticChunkingStrategy,
  RecursiveChunkingStrategy,
  ChunkingStrategyFactory,
} from './chunking-strategy'

// ─── 向量存储（数据库读写 + 检索）─────────────────────
export {
  SQLiteVecProvider,
  createSQLiteVecProvider,
  getSQLiteVecProvider,
} from './sqlite-vec-provider'

// ─── 文档解析 ───────────────────────────────────────────
export {
  DocumentParserFactory,
  createDocumentParserFactory,
  inferMimeType,
  SUPPORTED_MIME_TYPES,
} from './document-parser'

// ─── 处理流水线 ─────────────────────────────────────────
export {
  DocumentPipeline,
  createDocumentPipeline,
} from './pipeline'
export type { PipelineOptions, PipelineResult, PipelineStage } from './pipeline'

// ─── 问答 ───────────────────────────────────────────────
export {
  extractChatContext,
  buildRAGSystemPrompt,
  buildRAGUserMessage,
} from './rag-chat'
export type { ChatContext } from './rag-chat'

// ─── 文件工具 ───────────────────────────────────────────
export { ensureDir, atomicWrite, shortId, readJsonFile, writeJsonFile, removeDir } from './fs-utils'
