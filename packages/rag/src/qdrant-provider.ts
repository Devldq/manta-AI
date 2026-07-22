import { QdrantClient } from '@qdrant/js-client-rest'
import { v5 as uuidv5 } from 'uuid'
import type {
  DocumentChunk,
  DocumentMetadata,
  KnowledgeBaseConfig,
  KnowledgeBaseStats,
  RAGProvider,
  RetrievalResult,
  SearchOptions,
} from './types'

const POINT_NAMESPACE = 'bc93d322-ff7e-4ee8-98d7-a42256b1ee24'
const VECTOR_NAME = 'content'
const DEFAULT_COLLECTION_PREFIX = 'manta_kb_'
const UPSERT_BATCH_SIZE = 256

type QdrantPayload = Record<string, unknown>

export interface QdrantProviderOptions {
  url?: string
  apiKey?: string
  collectionPrefix?: string
  timeoutMs?: number
}

export interface HybridSearchOptions extends SearchOptions {
  rrfK?: number
  denseWeight?: number
  lexicalWeight?: number
}

function payloadOf(value: unknown): QdrantPayload {
  return value && typeof value === 'object' ? value as QdrantPayload : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function collectionSafeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 180)
}

function pointId(kind: 'document' | 'chunk', knowledgeBaseId: string, id: string): string {
  return uuidv5(`${kind}:${knowledgeBaseId}:${id}`, POINT_NAMESPACE)
}

function documentFromPayload(payload: QdrantPayload): DocumentMetadata | null {
  const id = asString(payload.original_id)
  const name = asString(payload.name)
  const type = asString(payload.mime_type)
  const uploadedAt = asString(payload.uploaded_at)
  const status = asString(payload.status)
  if (!id || !name || !type || !uploadedAt || !status) return null
  if (!['pending', 'processing', 'ready', 'error'].includes(status)) return null
  return {
    id,
    name,
    type,
    size: asNumber(payload.size) ?? 0,
    uploadedAt,
    processedAt: asString(payload.processed_at),
    chunkCount: asNumber(payload.chunk_count) ?? 0,
    status: status as DocumentMetadata['status'],
    error: asString(payload.error),
    sourcePath: asString(payload.source_path),
    sourceSha256: asString(payload.source_sha256),
  }
}

function chunkFromPayload(payload: QdrantPayload): DocumentChunk | null {
  const id = asString(payload.original_id)
  const documentId = asString(payload.document_id)
  const content = asString(payload.content)
  if (!id || !documentId || content === undefined) return null
  return {
    id,
    documentId,
    content,
    metadata: payloadOf(payload.metadata),
    startIndex: asNumber(payload.start_index),
    endIndex: asNumber(payload.end_index),
  }
}

export class QdrantProvider implements RAGProvider {
  readonly id = 'qdrant'
  readonly name = 'Qdrant'

  private readonly client: QdrantClient
  private readonly prefix: string
  private readonly url: string
  private initialized = false

  constructor(options: QdrantProviderOptions = {}) {
    const url = options.url || process.env.QDRANT_URL || 'http://127.0.0.1:6333'
    this.url = url
    this.prefix = options.collectionPrefix || process.env.QDRANT_COLLECTION_PREFIX || DEFAULT_COLLECTION_PREFIX
    this.client = new QdrantClient({
      url,
      apiKey: options.apiKey || process.env.QDRANT_API_KEY,
      timeout: options.timeoutMs ?? 10_000,
      checkCompatibility: true,
    })
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    try {
      await this.client.getCollections()
      this.initialized = true
    } catch (error) {
      throw new Error(`Qdrant 不可用，请确认本地服务已启动（${this.url}）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async createKnowledgeBase(id: string, _name: string, config?: KnowledgeBaseConfig): Promise<void> {
    await this.ensureInitialized()
    const collection = this.collectionName(id)
    if (await this.collectionExists(collection)) return
    const dimensions = config?.dimensions ?? 1536
    await this.client.createCollection(collection, {
      vectors: { [VECTOR_NAME]: { size: dimensions, distance: 'Cosine', on_disk: true } },
      on_disk_payload: true,
    })
    await Promise.all([
      this.client.createPayloadIndex(collection, { wait: true, field_name: 'record_type', field_schema: 'keyword' }),
      this.client.createPayloadIndex(collection, { wait: true, field_name: 'document_id', field_schema: 'keyword' }),
      this.client.createPayloadIndex(collection, { wait: true, field_name: 'source_sha256', field_schema: 'keyword' }),
    ])
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.ensureInitialized()
    const collection = this.collectionName(id)
    if (await this.collectionExists(collection)) await this.client.deleteCollection(collection)
  }

  async insertPendingDocument(knowledgeBaseId: string, document: DocumentMetadata): Promise<void> {
    await this.ensureInitialized()
    await this.requireCollection(knowledgeBaseId)
    await this.upsertDocument(knowledgeBaseId, { ...document, status: 'processing', chunkCount: 0 })
  }

  async updateDocumentStatus(documentId: string, status: DocumentMetadata['status'], error?: string): Promise<void> {
    await this.ensureInitialized()
    const located = await this.findDocument(documentId)
    if (!located) return
    await this.upsertDocument(located.knowledgeBaseId, {
      ...located.document,
      status,
      error,
      processedAt: status === 'ready' || status === 'error' ? new Date().toISOString() : located.document.processedAt,
    })
  }

  async cleanupStaleDocuments(): Promise<Array<{ kbId: string; docId: string; docName: string }>> {
    await this.ensureInitialized()
    const stale: Array<{ kbId: string; docId: string; docName: string }> = []
    for (const collection of await this.knowledgeCollections()) {
      const kbId = collection.slice(this.prefix.length)
      const documents = await this.scrollPayloads(collection, {
        must: [
          { key: 'record_type', match: { value: 'document' } },
          { key: 'status', match: { value: 'processing' } },
        ],
      })
      for (const payload of documents) {
        const document = documentFromPayload(payload)
        if (!document) continue
        // Processing state is owned by the durable Job runtime. Merely
        // observing a document during service startup must never rewrite it to
        // error; the recovered Job will either continue or request recovery.
        stale.push({ kbId, docId: document.id, docName: document.name })
      }
    }
    return stale
  }

  async addDocument(knowledgeBaseId: string, document: DocumentMetadata, chunks: DocumentChunk[]): Promise<void> {
    await this.ensureInitialized()
    await this.requireCollection(knowledgeBaseId)
    if (chunks.some((chunk) => !chunk.embedding?.length)) {
      throw new Error(`Qdrant 写入失败：文档 ${document.name} 存在未生成 Embedding 的分块`)
    }

    await this.client.delete(this.collectionName(knowledgeBaseId), {
      wait: true,
      filter: { must: [{ key: 'document_id', match: { value: document.id } }] },
    })

    const collection = this.collectionName(knowledgeBaseId)
    const points = chunks.map((chunk) => ({
      id: pointId('chunk', knowledgeBaseId, chunk.id),
      vector: { [VECTOR_NAME]: chunk.embedding! },
      payload: {
        record_type: 'chunk',
        original_id: chunk.id,
        document_id: document.id,
        document_name: document.name,
        content: chunk.content,
        metadata: chunk.metadata,
        // A crashed ingest must never expose a partially written document.
        // Legacy points do not have this flag and remain visible.
        catalog_committed: false,
        ...(chunk.startIndex === undefined ? {} : { start_index: chunk.startIndex }),
        ...(chunk.endIndex === undefined ? {} : { end_index: chunk.endIndex }),
      },
    }))
    for (let index = 0; index < points.length; index += UPSERT_BATCH_SIZE) {
      await this.client.upsert(collection, { wait: true, points: points.slice(index, index + UPSERT_BATCH_SIZE) })
    }
    await this.upsertDocument(knowledgeBaseId, {
      ...document,
      status: 'ready',
      chunkCount: chunks.length,
      processedAt: new Date().toISOString(),
      error: undefined,
    })
    await this.commitDocumentVisibility(knowledgeBaseId, document.id)
  }

  async commitDocumentVisibility(knowledgeBaseId: string, documentId: string): Promise<void> {
    await this.ensureInitialized()
    await this.requireCollection(knowledgeBaseId)
    await this.client.setPayload(this.collectionName(knowledgeBaseId), {
      wait: true,
      payload: { catalog_committed: true },
      filter: {
        must: [
          { key: 'record_type', match: { value: 'chunk' } },
          { key: 'document_id', match: { value: documentId } },
        ],
      },
    })
  }

  async removeDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    await this.ensureInitialized()
    const collection = this.collectionName(knowledgeBaseId)
    if (!await this.collectionExists(collection)) return
    await this.client.delete(collection, {
      wait: true,
      filter: {
        should: [
          { key: 'document_id', match: { value: documentId } },
          { key: 'original_id', match: { value: documentId } },
        ],
      },
    })
  }

  async vectorSearch(knowledgeBaseId: string, queryEmbedding: number[], options?: SearchOptions): Promise<RetrievalResult[]> {
    await this.ensureInitialized()
    await this.requireCollection(knowledgeBaseId)
    const response = await this.client.query(this.collectionName(knowledgeBaseId), {
      query: queryEmbedding,
      using: VECTOR_NAME,
      limit: options?.topK ?? 5,
      score_threshold: options?.threshold ?? 0,
      with_payload: true,
      with_vector: false,
      filter: {
        must: [
          { key: 'record_type', match: { value: 'chunk' } },
          ...this.toQdrantFilter(options?.filter),
        ],
        must_not: [{ key: 'catalog_committed', match: { value: false } }],
      },
    })
    return response.points.flatMap((result) => {
      const payload = payloadOf(result.payload)
      const chunk = chunkFromPayload(payload)
      if (!chunk) return []
      return [{
        chunk,
        score: result.score,
        metadata: {
          documentName: asString(payload.document_name) || '',
          documentId: chunk.documentId,
        },
      }]
    })
  }

  /** Dense retrieval plus local BM25 lexical ranking, fused with weighted RRF. */
  async hybridSearch(knowledgeBaseId: string, queryEmbedding: number[], query: string, options: HybridSearchOptions = {}): Promise<RetrievalResult[]> {
    const topK = options.topK ?? 5
    const candidateLimit = Math.max(40, topK * 6)
    const [dense, chunks] = await Promise.all([
      this.vectorSearch(knowledgeBaseId, queryEmbedding, { ...options, topK: candidateLimit, threshold: 0 }),
      this.getKnowledgeBaseChunks(knowledgeBaseId, options.filter),
    ])
    const lexical = bm25Rank(query, chunks).slice(0, candidateLimit)
    const rrfK = Math.max(1, options.rrfK ?? 60)
    const denseWeight = options.denseWeight ?? 1
    const lexicalWeight = options.lexicalWeight ?? 1
    const byId = new Map<string, { result: RetrievalResult; score: number }>()
    dense.forEach((result, index) => byId.set(result.chunk.id, { result, score: denseWeight / (rrfK + index + 1) }))
    lexical.forEach(({ result }, index) => {
      const current = byId.get(result.chunk.id)
      const lexicalScore = lexicalWeight / (rrfK + index + 1)
      byId.set(result.chunk.id, current ? { result: current.result, score: current.score + lexicalScore } : { result, score: lexicalScore })
    })
    const ranked = [...byId.values()].sort((left, right) => right.score - left.score).slice(0, topK)
    const maximum = ranked[0]?.score || 1
    return ranked.map(({ result, score }) => ({ ...result, score: score / maximum }))
  }

  async getKnowledgeBaseChunks(knowledgeBaseId: string, filter?: Record<string, unknown>): Promise<RetrievalResult[]> {
    await this.ensureInitialized()
    await this.requireCollection(knowledgeBaseId)
    const payloads = await this.scrollPayloads(this.collectionName(knowledgeBaseId), {
      must: [
        { key: 'record_type', match: { value: 'chunk' } },
        ...this.toQdrantFilter(filter),
      ],
      must_not: [{ key: 'catalog_committed', match: { value: false } }],
    })
    return payloads.flatMap((payload) => {
      const chunk = chunkFromPayload(payload)
      return chunk ? [{ chunk, score: 0, metadata: { documentName: asString(payload.document_name) || '', documentId: chunk.documentId } }] : []
    })
  }

  async getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats> {
    await this.ensureInitialized()
    const collection = this.collectionName(knowledgeBaseId)
    if (!await this.collectionExists(collection)) return { documentCount: 0, chunkCount: 0, totalSize: 0 }
    const documents = (await this.scrollPayloads(collection, { must: [{ key: 'record_type', match: { value: 'document' } }] }))
      .map(documentFromPayload)
      .filter((document): document is DocumentMetadata => document !== null)
    return {
      documentCount: documents.length,
      chunkCount: documents.reduce((sum, document) => sum + (document.chunkCount ?? 0), 0),
      totalSize: documents.reduce((sum, document) => sum + document.size, 0),
      lastUpdated: documents.map((document) => document.processedAt).filter(Boolean).sort().at(-1),
    }
  }

  async getDocuments(knowledgeBaseId: string): Promise<DocumentMetadata[]> {
    await this.ensureInitialized()
    const collection = this.collectionName(knowledgeBaseId)
    if (!await this.collectionExists(collection)) return []
    return (await this.scrollPayloads(collection, { must: [{ key: 'record_type', match: { value: 'document' } }] }))
      .map(documentFromPayload)
      .filter((document): document is DocumentMetadata => document !== null)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  }

  async getDocument(documentId: string): Promise<DocumentMetadata | null> {
    await this.ensureInitialized()
    return (await this.findDocument(documentId))?.document ?? null
  }

  async hasSourceSha256(sha256: string): Promise<boolean> {
    await this.ensureInitialized()
    for (const collection of await this.knowledgeCollections()) {
      const points = await this.scrollPayloads(collection, {
        must: [
          { key: 'record_type', match: { value: 'document' } },
          { key: 'source_sha256', match: { value: sha256 } },
        ],
      }, 1)
      if (points.length) return true
    }
    return false
  }

  async getDocumentChunks(documentId: string, limit = 50): Promise<DocumentChunk[]> {
    await this.ensureInitialized()
    for (const collection of await this.knowledgeCollections()) {
      const payloads = await this.scrollPayloads(collection, {
        must: [
          { key: 'record_type', match: { value: 'chunk' } },
          { key: 'document_id', match: { value: documentId } },
        ],
        must_not: [{ key: 'catalog_committed', match: { value: false } }],
      }, limit)
      if (payloads.length) {
        return payloads.map(chunkFromPayload).filter((chunk): chunk is DocumentChunk => chunk !== null)
          .sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0))
      }
    }
    return []
  }

  async checkpoint(): Promise<void> {}

  async integrityCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.getCollections()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async close(): Promise<void> {
    this.initialized = false
  }

  async reopen(_storageDir: string): Promise<void> {
    this.initialized = false
    await this.initialize()
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }

  private collectionName(knowledgeBaseId: string): string {
    return `${this.prefix}${collectionSafeId(knowledgeBaseId)}`
  }

  private async knowledgeCollections(): Promise<string[]> {
    const response = await this.client.getCollections()
    return response.collections.map((collection) => collection.name).filter((name) => name.startsWith(this.prefix))
  }

  private async collectionExists(collection: string): Promise<boolean> {
    return (await this.knowledgeCollections()).includes(collection)
  }

  private async requireCollection(knowledgeBaseId: string): Promise<void> {
    const collection = this.collectionName(knowledgeBaseId)
    if (!await this.collectionExists(collection)) {
      throw new Error(`Qdrant Collection 不存在：${collection}，请重新创建知识库`)
    }
  }

  private async upsertDocument(knowledgeBaseId: string, document: DocumentMetadata): Promise<void> {
    await this.client.upsert(this.collectionName(knowledgeBaseId), {
      wait: true,
      points: [{
        id: pointId('document', knowledgeBaseId, document.id),
        vector: {},
        payload: {
          record_type: 'document',
          original_id: document.id,
          document_id: document.id,
          name: document.name,
          mime_type: document.type,
          size: document.size,
          uploaded_at: document.uploadedAt,
          status: document.status,
          chunk_count: document.chunkCount ?? 0,
          ...(document.processedAt ? { processed_at: document.processedAt } : {}),
          ...(document.error ? { error: document.error } : {}),
          ...(document.sourcePath ? { source_path: document.sourcePath } : {}),
          ...(document.sourceSha256 ? { source_sha256: document.sourceSha256 } : {}),
        },
      }],
    })
  }

  private async findDocument(documentId: string): Promise<{ knowledgeBaseId: string; document: DocumentMetadata } | null> {
    for (const collection of await this.knowledgeCollections()) {
      const payloads = await this.scrollPayloads(collection, {
        must: [
          { key: 'record_type', match: { value: 'document' } },
          { key: 'original_id', match: { value: documentId } },
        ],
      }, 1)
      const document = payloads[0] ? documentFromPayload(payloads[0]) : null
      if (document) return { knowledgeBaseId: collection.slice(this.prefix.length), document }
    }
    return null
  }

  private async scrollPayloads(collection: string, filter: Record<string, unknown>, requestedLimit?: number): Promise<QdrantPayload[]> {
    const payloads: QdrantPayload[] = []
    let offset: string | number | Record<string, unknown> | null | undefined
    do {
      const remaining = requestedLimit === undefined ? 256 : Math.max(0, requestedLimit - payloads.length)
      if (requestedLimit !== undefined && remaining === 0) break
      const page = await this.client.scroll(collection, {
        filter,
        limit: Math.min(remaining || 256, 256),
        offset,
        with_payload: true,
        with_vector: false,
      })
      payloads.push(...page.points.map((point) => payloadOf(point.payload)))
      offset = page.next_page_offset
    } while (offset !== null && offset !== undefined)
    return payloads
  }

  private toQdrantFilter(filter?: Record<string, unknown>): Array<Record<string, unknown>> {
    if (!filter) return []
    return Object.entries(filter).map(([key, value]) => ({ key, match: { value } }))
  }
}

function bm25Rank(query: string, chunks: RetrievalResult[]): Array<{ result: RetrievalResult; score: number }> {
  const queryTerms = tokenize(query)
  if (!queryTerms.length || !chunks.length) return []
  const documents = chunks.map((result) => tokenize(result.chunk.content))
  const averageLength = documents.reduce((sum, terms) => sum + terms.length, 0) / documents.length || 1
  const documentFrequency = new Map<string, number>()
  for (const terms of documents) for (const term of new Set(terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  return chunks.map((result, index) => {
    const terms = documents[index]
    const frequencies = new Map<string, number>()
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    let score = 0
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0
      if (!frequency) continue
      const frequencyInDocuments = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (documents.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5))
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * terms.length / averageLength)
      score += idf * frequency * 2.2 / denominator
    }
    return { result, score }
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score)
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const cjk = [...normalized].filter((character) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character))
  const grams = cjk.length <= 1 ? cjk : cjk.slice(0, -1).map((character, index) => `${character}${cjk[index + 1]}`)
  return [...words, ...cjk, ...grams]
}

let providerInstance: QdrantProvider | null = null

export function createQdrantProvider(options?: QdrantProviderOptions): QdrantProvider {
  return new QdrantProvider(options)
}

export function configureQdrantProvider(options?: QdrantProviderOptions): QdrantProvider {
  if (providerInstance) throw new Error('QdrantProvider is already configured; reset it before reconfiguring')
  providerInstance = new QdrantProvider(options)
  return providerInstance
}

export function getQdrantProvider(): QdrantProvider {
  if (!providerInstance) throw new Error('QdrantProvider has not been configured')
  return providerInstance
}

export async function resetQdrantProvider(): Promise<void> {
  const current = providerInstance
  await current?.close()
  if (providerInstance === current) providerInstance = null
}
