import { ChunkingStrategyFactory } from './chunking-strategy'
import { createDocumentParserFactory } from './document-parser'
import type { ChunkingStrategy, DocumentChunk, DocumentMetadata, EmbeddingService, RAGProvider, RetrievalResult, SearchOptions } from './types'

export interface ParserRegistry {
  parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]>
}

export interface ChunkerRegistry {
  resolve(name: 'fixed' | 'semantic' | 'recursive' | 'paragraph-v1'): ChunkingStrategy
}

export interface CatalogRepository {
  commitDocument(knowledgeBaseId: string, document: DocumentMetadata): Promise<void>
}

export interface LexicalIndex {
  search(knowledgeBaseId: string, query: string, options?: SearchOptions): Promise<RetrievalResult[]>
}

export interface RagClock { now(): Date }
export interface RagIdFactory { create(): string }

export interface RagEngineDependencies {
  parsers: ParserRegistry
  chunkers: ChunkerRegistry
  embeddings: EmbeddingService
  denseIndex: RAGProvider
  lexicalIndex?: LexicalIndex
  catalog: CatalogRepository
  clock: RagClock
  ids: RagIdFactory
}

export interface RagPreviewOptions {
  chunker: 'fixed' | 'semantic' | 'recursive' | 'paragraph-v1'
  chunkSize: number
  overlap: number
}

export interface RagIngestOptions extends RagPreviewOptions {
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}

/** UI-free RAG composition root. Every side effect is supplied by the caller. */
export class RagEngine {
  constructor(private readonly dependencies: RagEngineDependencies) {}

  async preview(buffer: Buffer, metadata: DocumentMetadata, options: RagPreviewOptions): Promise<DocumentChunk[]> {
    const raw = await this.dependencies.parsers.parse(buffer, metadata)
    return rechunk(raw, metadata, this.dependencies.chunkers.resolve(options.chunker), options)
  }

  async ingest(knowledgeBaseId: string, buffer: Buffer, metadata: DocumentMetadata, options: RagIngestOptions): Promise<{ document: DocumentMetadata; chunks: DocumentChunk[] }> {
    options.signal?.throwIfAborted()
    const chunks = await this.preview(buffer, metadata, options)
    if (!chunks.length) throw new Error('Document did not produce any searchable chunks')
    const batchSize = 20
    for (let index = 0; index < chunks.length; index += batchSize) {
      options.signal?.throwIfAborted()
      const batch = chunks.slice(index, index + batchSize)
      const embeddings = await this.dependencies.embeddings.embedBatch(batch.map((chunk) => chunk.content))
      options.signal?.throwIfAborted()
      embeddings.forEach((embedding, offset) => { batch[offset].embedding = embedding })
      options.onProgress?.(Math.min(chunks.length, index + batch.length), chunks.length)
    }
    const document: DocumentMetadata = { ...metadata, status: 'ready', chunkCount: chunks.length, processedAt: this.dependencies.clock.now().toISOString() }
    await this.dependencies.denseIndex.addDocument(knowledgeBaseId, document, chunks)
    await this.dependencies.catalog.commitDocument(knowledgeBaseId, document)
    return { document, chunks }
  }

  async search(knowledgeBaseId: string, query: string, options?: SearchOptions): Promise<RetrievalResult[]> {
    const embedding = await this.dependencies.embeddings.embed(query)
    return this.dependencies.denseIndex.vectorSearch(knowledgeBaseId, embedding, options)
  }

  createDocumentMetadata(input: Pick<DocumentMetadata, 'name' | 'type' | 'size'>): DocumentMetadata {
    return { ...input, id: this.dependencies.ids.create(), uploadedAt: this.dependencies.clock.now().toISOString(), status: 'pending' }
  }
}

export function createDefaultParserRegistry(): ParserRegistry {
  const factory = createDocumentParserFactory()
  return { parse: (buffer, metadata) => factory.parseDocument(buffer, metadata) }
}

export function createDefaultChunkerRegistry(): ChunkerRegistry {
  return { resolve: (name) => ChunkingStrategyFactory.create(name === 'paragraph-v1' ? 'semantic' : name) }
}

function rechunk(raw: DocumentChunk[], metadata: DocumentMetadata, strategy: ChunkingStrategy, options: RagPreviewOptions): DocumentChunk[] {
  const result: DocumentChunk[] = []
  let globalIndex = 0
  for (const parent of raw) {
    let searchFrom = 0
    for (const content of strategy.chunk(parent.content, { chunkSize: options.chunkSize * 4, overlap: options.overlap * 4 })) {
      const relative = parent.content.indexOf(content, searchFrom)
      const start = (parent.startIndex ?? 0) + (relative >= 0 ? relative : searchFrom)
      searchFrom = (relative >= 0 ? relative : searchFrom) + content.length
      result.push({
        id: `${metadata.name}_${globalIndex}`,
        documentId: metadata.id,
        sourceSha256: parent.sourceSha256 ?? metadata.sourceSha256,
        sourceVersion: parent.sourceVersion,
        content,
        startIndex: start,
        endIndex: start + content.length,
        metadata: { ...parent.metadata, parentChunkId: parent.id, source: metadata.name, index: globalIndex, tokenEstimate: Math.ceil(content.length / 4) },
      })
      globalIndex++
    }
  }
  return result
}
