import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { CreateRagUploadSessionSchema } from '@manta/contracts'
import type { TaskRuntime } from '@manta/task-runtime'
import { z } from 'zod'
import type { QdrantProvider } from '@manta/rag/qdrant'
import { createKnowledgeBase, deleteKnowledgeBase, getKnowledgeBase, listKnowledgeBases } from '../core/storage/knowledge-base/store.js'
import { buildEmbeddingService } from './rag.js'
import type { RagStagingStore } from '../storage/rag-staging-store.js'
import { RagSourceAssetStore } from '../storage/rag-source-assets.js'
import { RagUploadSessionStore } from '../storage/rag-upload-session-store.js'
import { RetrievalLabStore } from '../core/engine/rag/retrieval-lab-store.js'
import { searchStrategy } from '../core/engine/rag/retrieval-lab-executors.js'

export interface RagV1RoutesOptions {
  runtime: TaskRuntime
  staging: RagStagingStore
  knowledgeRoot: string
  uploadRoot: string
  provider: QdrantProvider
}

const KnowledgeBaseParamsSchema = z.object({ id: z.string().min(1) })
const CreateKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  config: z.object({
    dimensions: z.number().int().positive().optional(),
    similarityThreshold: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().optional(),
    embeddingConfig: z.object({
      provider: z.enum(['openai', 'local']),
      model: z.string().min(1),
      apiKey: z.string().optional(),
      baseUrl: z.string().url().optional(),
      dimensions: z.number().int().positive(),
    }).optional(),
    chunkingConfig: z.object({
      strategy: z.enum(['fixed', 'semantic', 'recursive']),
      chunkSize: z.number().int().positive(),
      overlap: z.number().int().nonnegative(),
    }).optional(),
  }).default({}),
})
const IngestDocumentSchema = z.object({
  assetId: z.string().regex(/^source\.[a-f0-9]{64}$/),
  strategyVersionId: z.string().min(1).optional(),
  chunkStrategy: z.enum(['fixed', 'semantic', 'recursive']).optional(),
  chunkSize: z.number().int().positive().optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
})
const UploadSessionParamsSchema = z.object({ sessionId: z.string().regex(/^upload\.[0-9a-f-]{36}$/) })
const UploadPartParamsSchema = UploadSessionParamsSchema.extend({ partNumber: z.coerce.number().int().nonnegative() })
const SearchSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  query: z.string().trim().min(1),
  topK: z.number().int().positive().max(100).optional(),
  threshold: z.number().min(0).max(1).optional(),
  strategyVersionId: z.string().min(1).optional(),
})

export const ragV1Routes: FastifyPluginAsync<RagV1RoutesOptions> = async (app, options) => {
  const sourceAssets = new RagSourceAssetStore(`${options.knowledgeRoot}/source-assets`)
  const uploadSessions = new RagUploadSessionStore(options.uploadRoot)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))

  app.get('/v1/knowledge-bases', async () => ({ data: await listKnowledgeBases() }))

  app.post('/v1/knowledge-bases', async (request, reply) => {
    try {
      const input = CreateKnowledgeBaseSchema.parse(request.body)
      const dimensions = input.config.embeddingConfig?.dimensions ?? input.config.dimensions ?? 1536
      const knowledgeBase = await createKnowledgeBase({
        name: input.name,
        description: input.description,
        providerId: 'qdrant',
        config: { ...input.config, dimensions },
      })
      try { await options.provider.createKnowledgeBase(knowledgeBase.id, knowledgeBase.name, knowledgeBase.config) }
      catch (error) { await deleteKnowledgeBase(knowledgeBase.id); throw error }
      return reply.status(201).send({ data: knowledgeBase })
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/knowledge-bases/:id', async (request, reply) => {
    const { id } = KnowledgeBaseParamsSchema.parse(request.params)
    const knowledgeBase = await getKnowledgeBase(id)
    return knowledgeBase ? { data: knowledgeBase } : reply.status(404).send({ error: { code: 'KNOWLEDGE_BASE_NOT_FOUND', message: `Knowledge base ${id} was not found` } })
  })

  app.post('/v1/knowledge-bases/:id/upload-sessions', async (request, reply) => {
    try {
      const { id } = KnowledgeBaseParamsSchema.parse(request.params)
      if (!await getKnowledgeBase(id)) return reply.status(404).send({ error: { code: 'KNOWLEDGE_BASE_NOT_FOUND', message: `Knowledge base ${id} was not found` } })
      const input = CreateRagUploadSessionSchema.parse(request.body)
      const session = await uploadSessions.create({
        ...input,
        knowledgeBaseId: id,
        idempotencyKey: header(request.headers['idempotency-key']),
      })
      return reply.status(201).header('location', `/v1/upload-sessions/${session.id}`).send({ data: session })
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/upload-sessions/:sessionId', async (request, reply) => {
    try {
      const { sessionId } = UploadSessionParamsSchema.parse(request.params)
      const session = await uploadSessions.get(sessionId)
      return session ? { data: session } : reply.status(404).send({ error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: `Upload Session ${sessionId} was not found` } })
    } catch (error) { return sendError(reply, error) }
  })

  app.put('/v1/upload-sessions/:sessionId/parts/:partNumber', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    try {
      const { sessionId, partNumber } = UploadPartParamsSchema.parse(request.params)
      if (!Buffer.isBuffer(request.body)) return reply.status(400).send({ error: { code: 'BINARY_BODY_REQUIRED', message: 'Upload parts require application/octet-stream bytes' } })
      const session = await uploadSessions.putPart(sessionId, partNumber, request.body, header(request.headers['x-part-sha256']))
      return { data: session }
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/upload-sessions/:sessionId/complete', async (request, reply) => {
    try {
      const { sessionId } = UploadSessionParamsSchema.parse(request.params)
      const completed = await uploadSessions.complete(sessionId, sourceAssets)
      return { data: { session: completed.session, asset: completed.asset } }
    } catch (error) { return sendError(reply, error) }
  })

  app.delete('/v1/upload-sessions/:sessionId', async (request, reply) => {
    try {
      const { sessionId } = UploadSessionParamsSchema.parse(request.params)
      const removed = await uploadSessions.cancel(sessionId)
      return removed ? reply.status(204).send() : reply.status(404).send({ error: { code: 'UPLOAD_SESSION_NOT_FOUND', message: `Upload Session ${sessionId} was not found` } })
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/knowledge-bases/:id/uploads', async (request, reply) => {
    try {
      const { id } = KnowledgeBaseParamsSchema.parse(request.params)
      if (!await getKnowledgeBase(id)) return reply.status(404).send({ error: { code: 'KNOWLEDGE_BASE_NOT_FOUND', message: `Knowledge base ${id} was not found` } })
      const file = await request.file()
      if (!file) return reply.status(400).send({ error: { code: 'FILE_REQUIRED', message: 'A document file is required' } })
      const staged = await options.staging.stage(id, file.file, {
        name: file.filename,
        type: file.mimetype,
        idempotencyKey: header(request.headers['idempotency-key']),
      })
      const asset = sourceAssets.promote(options.staging.pathFor(id, staged.id), {
        sha256: staged.sha256,
        name: staged.name,
        mediaType: staged.type,
        size: staged.size,
      })
      await options.staging.remove(id, staged.id)
      return reply.status(201).send({ data: asset })
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/knowledge-bases/:id/documents', async (request, reply) => {
    try {
      const { id } = KnowledgeBaseParamsSchema.parse(request.params)
      if (!await getKnowledgeBase(id)) return reply.status(404).send({ error: { code: 'KNOWLEDGE_BASE_NOT_FOUND', message: `Knowledge base ${id} was not found` } })
      const input = IngestDocumentSchema.parse(request.body)
      const asset = await sourceAssets.read(input.assetId)
      const documentId = `doc_${createHash('sha256').update(`${id}:${asset.sha256}`).digest('hex').slice(0, 32)}`
      const payload = {
        ...input,
        knowledgeBaseId: id,
        assetId: asset.assetId,
        sourceSha256: asset.sha256,
        documentId,
        fileName: asset.name,
        mediaType: asset.mediaType,
        size: asset.size,
      }
      const idempotencyKey = header(request.headers['idempotency-key']) ?? `rag-ingest:${id}:${asset.sha256}:${input.strategyVersionId ?? 'active'}`
      const job = options.runtime.createJob({ kind: 'rag.document.ingest', payload, metadata: { knowledgeBaseId: id, documentId }, maxAttempts: 3, idempotencyKey })
      return reply.status(202).header('location', `/v1/jobs/${job.id}`).send({ data: job })
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/knowledge/search', async (request, reply) => {
    try {
      const input = SearchSchema.parse(request.body)
      const knowledgeBase = await getKnowledgeBase(input.knowledgeBaseId)
      if (!knowledgeBase) return reply.status(404).send({ error: { code: 'KNOWLEDGE_BASE_NOT_FOUND', message: `Knowledge base ${input.knowledgeBaseId} was not found` } })
      const lab = new RetrievalLabStore(`${options.knowledgeRoot}/retrieval-lab`)
      const selectedStrategy = input.strategyVersionId ? lab.getStrategy(input.strategyVersionId) : lab.activeStrategy(input.knowledgeBaseId)
      if (selectedStrategy) {
        const found = await searchStrategy({ knowledge: options.knowledgeRoot }, selectedStrategy.id, input.query)
        return { data: { query: input.query, results: found.results, totalResults: found.results.length, strategyVersionId: found.strategyVersionId } }
      }
      const embedding = await buildEmbeddingService(knowledgeBase.config).embed(input.query)
      const results = await options.provider.vectorSearch(input.knowledgeBaseId, embedding, {
        topK: input.topK ?? knowledgeBase.config.topK,
        threshold: input.threshold ?? knowledgeBase.config.similarityThreshold,
        includeMetadata: true,
      })
      return { data: { query: input.query, results, totalResults: results.length, strategyVersionId: 'legacy-default' } }
    } catch (error) { return sendError(reply, error) }
  })
}

function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }

function sendError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown): unknown {
  const isValidation = error instanceof z.ZodError
  const code = isValidation ? 'INVALID_REQUEST' : errorCode(error)
  const status = isValidation || code.startsWith('INVALID_') || code === 'BINARY_BODY_REQUIRED' ? 400
    : code === 'UPLOAD_SESSION_NOT_FOUND' ? 404
      : ['IDEMPOTENCY_CONFLICT', 'PART_CONFLICT', 'UPLOAD_ALREADY_COMPLETED'].includes(code) ? 409
        : ['UPLOAD_INCOMPLETE', 'UPLOAD_HASH_MISMATCH', 'PART_HASH_MISMATCH'].includes(code) ? 422 : 500
  return reply.status(status).send({ error: { code, message: error instanceof Error ? error.message : String(error) } })
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'RAG_OPERATION_FAILED'
}
