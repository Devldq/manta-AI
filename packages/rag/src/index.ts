/**
 * @manta/rag — 自包含 RAG（Retrieval-Augmented Generation）引擎
 *
 * 包含：文档解析、分块策略、向量存储（SQLite）、Embedding 服务、Fastify 路由
 *
 * 使用方式:
 *   // 引擎 API
 *   import { createDocumentPipeline, getSQLiteVecProvider, createEmbeddingService } from '@manta/rag'
 *
 *   // Fastify 路由插件
 *   import { ragRoutes } from '@manta/rag/routes'
 *   await app.register(ragRoutes)
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

// ─── 流水线 ─────────────────────────────────────────────
export { DocumentPipeline, createDocumentPipeline } from './pipeline'
export type { PipelineOptions, PipelineResult, PipelineStage } from './pipeline'

// ─── 分块策略 ───────────────────────────────────────────
export {
  FixedSizeChunkingStrategy,
  SemanticChunkingStrategy,
  RecursiveChunkingStrategy,
  ChunkingStrategyFactory,
} from './chunking-strategy'

// ─── 文档解析 ───────────────────────────────────────────
export {
  TextDocumentParser,
  PDFDocumentParser,
  DocxDocumentParser,
  DocDocumentParser,
  XlsxDocumentParser,
  PptxDocumentParser,
  PptDocumentParser,
  DocumentParserFactory,
  createDocumentParserFactory,
  inferMimeType,
  SUPPORTED_MIME_TYPES,
} from './document-parser'

// ─── 向量存储 ───────────────────────────────────────────
export {
  SQLiteVecProvider,
  createSQLiteVecProvider,
  getSQLiteVecProvider,
} from './sqlite-vec-provider'

// ─── Embedding 服务 ─────────────────────────────────────
export {
  OpenAIEmbeddingService,
  LocalEmbeddingService,
  createEmbeddingService,
  getAvailableEmbeddingModels,
  listLocalOllamaModels,
} from './embedding-service'
export type { OllamaModel } from './embedding-service'

// ─── 知识库存储 ─────────────────────────────────────────
export {
  listKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  knowledgeBaseExists,
} from './knowledge-base-store'
export type {
  KnowledgeBase,
  CreateKnowledgeBaseInput,
  UpdateKnowledgeBaseInput,
} from './knowledge-base-store'

// ─── 错误处理（供下游复用） ────────────────────────────
export { AppError, Errors, apiSuccess, apiError } from './error-handler'
export type { ApiResponse } from './error-handler'

// ─── 文件工具 ───────────────────────────────────────────
export { ensureDir, atomicWrite, shortId, readJsonFile, writeJsonFile, removeDir } from './fs-utils'
