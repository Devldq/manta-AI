/**
 * 文档处理流水线 (Pipeline)
 *
 * 流程: 解析 → 分块 → 向量化 → 写入向量库
 *
 * 使用方式:
 *   const pipeline = createDocumentPipeline({ embeddingService, ragProvider, chunkStrategy })
 *   const result = await pipeline.process(buffer, metadata, knowledgeBaseId)
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  DocumentMetadata,
  DocumentChunk,
  EmbeddingService,
  RAGProvider,
  ChunkingStrategy,
} from './types'
import { createDocumentParserFactory } from './document-parser'
import { ChunkingStrategyFactory } from './chunking-strategy'

// ─── 类型定义 ────────────────────────────────────────────────

export interface PipelineOptions {
  /** Embedding 服务 */
  embeddingService: EmbeddingService
  /** RAG Provider */
  ragProvider: RAGProvider
  /** 分块策略名称，默认 'recursive' */
  chunkStrategy?: 'fixed' | 'semantic' | 'recursive'
  /** 分块大小（字符数），默认 1000 */
  chunkSize?: number
  /** 分块重叠（字符数），默认 200 */
  chunkOverlap?: number
  /** 进度回调 */
  onProgress?: (stage: PipelineStage, progress: number, message: string) => void
}

export interface PipelineResult {
  document: DocumentMetadata
  chunks: DocumentChunk[]
  chunkCount: number
  totalTokens?: number
  processingTimeMs: number
}

export type PipelineStage = 'parsing' | 'chunking' | 'embedding' | 'storing'

// ─── 流水线实现 ──────────────────────────────────────────────

export class DocumentPipeline {
  private parserFactory = createDocumentParserFactory()
  private embeddingService: EmbeddingService
  private ragProvider: RAGProvider
  private chunkStrategy: ChunkingStrategy
  private options: PipelineOptions

  constructor(options: PipelineOptions) {
    this.embeddingService = options.embeddingService
    this.ragProvider = options.ragProvider
    this.chunkStrategy = ChunkingStrategyFactory.create(options.chunkStrategy || 'recursive')
    this.options = options
  }

  /**
   * 执行完整文档处理流水线
   * @param buffer - 文档二进制内容
   * @param metadata - 文档元数据（需包含 id, name, type）
   * @param knowledgeBaseId - 目标知识库 ID
   */
  async process(
    buffer: Buffer,
    metadata: DocumentMetadata,
    knowledgeBaseId: string
  ): Promise<PipelineResult> {
    const startTime = Date.now()
    const emit = this.options.onProgress || (() => {})

    try {
      // 1. 解析
      emit('parsing', 0, `正在解析文档: ${metadata.name}`)
      const rawChunks = await this.parserFactory.parseDocument(buffer, metadata)
      emit('parsing', 100, `解析完成，共 ${rawChunks.length} 个段落`)

      // 2. 分块（对每个段落的大段文本再分块）
      emit('chunking', 0, '正在分块...')
      const chunks = this.rechunk(rawChunks, metadata.id)
      emit('chunking', 100, `分块完成，共 ${chunks.length} 个块`)

      if (chunks.length === 0) {
        throw new Error('文档处理后未产生任何有效内容块')
      }

      // 3. 向量化
      emit('embedding', 0, `正在向量化 ${chunks.length} 个块...`)
      const texts = chunks.map((c) => c.content)
      const batchSize = 20 // 每批 20 个，避免 API 限制

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        const embeddings = await this.embeddingService.embedBatch(batch)

        for (let j = 0; j < batch.length; j++) {
          chunks[i + j].embedding = embeddings[j]
        }

        emit('embedding', Math.round(((i + batch.length) / texts.length) * 100),
          `向量化进度: ${i + batch.length}/${texts.length}`)
      }

      // 4. 写入向量库
      emit('storing', 0, '正在写入向量库...')
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

  /**
   * 仅解析不分块（用于预览）
   */
  async parseOnly(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    return this.parserFactory.parseDocument(buffer, metadata)
  }

  /**
   * 仅分块预览（不进行向量化）
   */
  async chunkPreview(text: string): Promise<string[]> {
    return this.chunkStrategy.chunk(text, {
      chunkSize: this.options.chunkSize || 1000,
      overlap: this.options.chunkOverlap || 200,
    })
  }

  /**
   * 对解析后的段落进行二次分块
   */
  private rechunk(rawChunks: DocumentChunk[], documentId: string): DocumentChunk[] {
    const result: DocumentChunk[] = []

    for (const raw of rawChunks) {
      const subTexts = this.chunkStrategy.chunk(raw.content, {
        chunkSize: this.options.chunkSize || 1000,
        overlap: this.options.chunkOverlap || 200,
      })

      for (const subText of subTexts) {
        result.push({
          id: uuidv4(),
          documentId,
          content: subText,
          metadata: { ...raw.metadata, parentChunkId: raw.id },
        })
      }
    }

    return result
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────

export function createDocumentPipeline(options: PipelineOptions): DocumentPipeline {
  return new DocumentPipeline(options)
}
