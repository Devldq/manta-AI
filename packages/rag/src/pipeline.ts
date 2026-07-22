/**
 * 文档处理流水线 — 解析 → 分块 → 向量化 → 写入向量库
 * Embedding 模型和存储 Provider 由调用方注入
 * 支持 Embedding 缓存（通过 CachedEmbeddingService）
 */

import type { DocumentMetadata, DocumentChunk, EmbeddingService, RAGProvider, ChunkingStrategy } from './types'
import { ChunkingStrategyFactory } from './chunking-strategy'
import { createDocumentParserFactory } from './document-parser'
import { CachedEmbeddingService, EmbeddingCacheManager } from './embedding-cache'

// ── 类型 ────────────────────────────────────────────────────

export interface PipelineOptions {
  /** Required by process(); previewChunks() intentionally works without it. */
  embeddingService?: EmbeddingService
  /** Required by process(); previewChunks() intentionally works without it. */
  ragProvider?: RAGProvider
  chunkStrategy?: 'fixed' | 'semantic' | 'recursive'
  /** 分块大小（Token 数），内部会按 ~4 字符/Token 转换为字符数 */
  chunkSize?: number
  /** 重叠大小（Token 数） */
  chunkOverlap?: number
  onProgress?: (stage: PipelineStage, progress: number, message: string) => void
  /** Embedding 缓存管理器（可选，提供后自动启用缓存） */
  cacheManager?: EmbeddingCacheManager
  /** 缓存使用的模型标识（可选，默认 'default'） */
  cacheModel?: string
  /** Cancels at safe parser, embedding-batch, and index boundaries. */
  signal?: AbortSignal
}

/** Token → 字符近似转换系数（混合中英文约 1 Token ≈ 4 字符） */
const TOKEN_TO_CHAR = 4

export interface PipelineResult {
  document: DocumentMetadata
  chunks: DocumentChunk[]
  chunkCount: number
  totalTokens?: number
  processingTimeMs: number
}

export type PipelineStage = 'parsing' | 'chunking' | 'embedding' | 'storing'

// ── 流水线实现 ──────────────────────────────────────────────

export class DocumentPipeline {
  private parserFactory = createDocumentParserFactory()
  private embeddingService?: EmbeddingService
  private ragProvider?: RAGProvider
  private chunkStrategy: ChunkingStrategy
  private options: PipelineOptions
  constructor(options: PipelineOptions) {
    // 如果提供了缓存管理器，使用带缓存的 EmbeddingService
    if (options.cacheManager && options.embeddingService) {
      this.embeddingService = new CachedEmbeddingService(
        options.embeddingService,
        options.cacheManager,
        options.cacheModel || 'default'
      )
    } else {
      this.embeddingService = options.embeddingService
    }

    this.ragProvider = options.ragProvider
    this.chunkStrategy = ChunkingStrategyFactory.create(options.chunkStrategy || 'recursive')
    this.options = options
  }

  async process(
    buffer: Buffer,
    metadata: DocumentMetadata,
    knowledgeBaseId: string
  ): Promise<PipelineResult> {
    const startTime = Date.now()
    const emit = this.options.onProgress || (() => {})

    try {
      if (!this.embeddingService || !this.ragProvider) throw new Error('process() requires embeddingService and ragProvider dependencies')
      this.options.signal?.throwIfAborted()
      // 1. 解析
      emit('parsing', 0, `正在解析文档: ${metadata.name}`)
      const rawChunks = await this.parserFactory.parseDocument(buffer, metadata)
      this.options.signal?.throwIfAborted()
      emit('parsing', 100, `解析完成，共 ${rawChunks.length} 个段落`)

      // 2. 分块
      emit('chunking', 0, '正在分块...')
      const chunks = this.rechunk(rawChunks, metadata.id, metadata.name)
      this.options.signal?.throwIfAborted()
      emit('chunking', 100, `分块完成，共 ${chunks.length} 个块`)

      if (chunks.length === 0) {
        throw new Error('文档处理后未产生任何有效内容块')
      }

      // 3. 向量化（调用方注入的 embedding 服务）
      emit('embedding', 0, `正在向量化 ${chunks.length} 个块...`)
      const texts = chunks.map((c) => c.content)
      const batchSize = 20

      try {
        for (let i = 0; i < texts.length; i += batchSize) {
          this.options.signal?.throwIfAborted()
          const batch = texts.slice(i, i + batchSize)
          const embeddings = await this.embeddingService.embedBatch(batch)
          this.options.signal?.throwIfAborted()

          for (let j = 0; j < batch.length; j++) {
            chunks[i + j].embedding = embeddings[j]
          }

          emit('embedding', Math.round(((i + batch.length) / texts.length) * 100),
            `向量化进度: ${i + batch.length}/${texts.length}`)
        }
      } catch (embedErr) {
        const dims = this.embeddingService.getDimensions()
        throw new Error(
          `Embedding 失败 — 维度: ${dims}，已处理: 0/${texts.length}\n` +
          `提示: 确认 Embedding 服务可用，模型已正确配置\n` +
          `${embedErr instanceof Error ? embedErr.message : String(embedErr)}`
        )
      }

      // 4. 写入向量库
      emit('storing', 0, '正在写入向量库...')
      this.options.signal?.throwIfAborted()
      await this.ragProvider.addDocument(knowledgeBaseId, metadata, chunks)
      emit('storing', 100, '写入完成')

      const processingTime = Date.now() - startTime

      return {
        document: { ...metadata, status: 'ready', chunkCount: chunks.length },
        chunks,
        chunkCount: chunks.length,
        processingTimeMs: processingTime,
      }
    } catch (error) {
      throw new Error(
        `文档处理流水线失败 (${metadata.name}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async parseOnly(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    return this.parserFactory.parseDocument(buffer, metadata)
  }

  /**
   * 预览分块（不向量化、不存储）— 解析 + 分块，返回带完整元数据的 chunks
   */
  async previewChunks(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    const rawChunks = await this.parserFactory.parseDocument(buffer, metadata)
    return this.rechunk(rawChunks, metadata.id, metadata.name)
  }

  private rechunk(rawChunks: DocumentChunk[], documentId: string, documentName?: string): DocumentChunk[] {
    const result: DocumentChunk[] = []
    const charSize = (this.options.chunkSize || 512) * TOKEN_TO_CHAR
    const charOverlap = (this.options.chunkOverlap || 50) * TOKEN_TO_CHAR
    const sourceName = documentName || documentId
    let globalIndex = 0

    for (const raw of rawChunks) {
      const subTexts = this.chunkStrategy.chunk(raw.content, {
        chunkSize: charSize,
        overlap: charOverlap,
      })

      // 顺序查找每个 subText 在 raw.content 中的位置，以追踪原文偏移
      let searchFrom = 0
      for (const subText of subTexts) {
        const relStart = raw.content.indexOf(subText, searchFrom)
        const startRel = relStart >= 0 ? relStart : searchFrom
        const endRel = startRel + subText.length
        searchFrom = relStart >= 0 ? endRel : searchFrom + subText.length

        const absStart = (raw.startIndex ?? 0) + startRel
        const absEnd = (raw.startIndex ?? 0) + endRel
        const tokenEstimate = Math.ceil(subText.length / TOKEN_TO_CHAR)

        result.push({
          id: `${sourceName}_${globalIndex}`,
          documentId,
          sourceSha256: raw.sourceSha256 ?? metadata.sourceSha256,
          sourceVersion: raw.sourceVersion,
          content: subText,
          startIndex: absStart,
          endIndex: absEnd,
          metadata: {
            ...raw.metadata,
            parentChunkId: raw.id,
            source: sourceName,
            index: globalIndex,
            tokenEstimate,
          },
        })
        globalIndex++
      }
    }

    return result
  }
}

export function createDocumentPipeline(options: PipelineOptions): DocumentPipeline {
  return new DocumentPipeline(options)
}
