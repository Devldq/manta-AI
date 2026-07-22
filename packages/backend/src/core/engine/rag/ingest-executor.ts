import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RagIngestPayloadSchema, type JsonValue } from '@manta/contracts'
import type { JobExecutorRegistration } from '@manta/task-runtime'
import { createDocumentPipeline, EmbeddingCacheManager, type DocumentMetadata } from '@manta/rag'
import type { QdrantProvider } from '@manta/rag/qdrant'
import { getKnowledgeBase } from '../../storage/knowledge-base/store.js'
import { buildEmbeddingService } from '../../../routes/rag.js'
import { RagSourceAssetStore } from '../../../storage/rag-source-assets.js'
import { recordUploadedRagDocument } from '../../../routes/rag-directory.js'

export interface RagIngestExecutorRoots {
  knowledge: string
  cache: string
  provider: QdrantProvider
}

export function createRagIngestExecutor(roots: RagIngestExecutorRoots): JobExecutorRegistration {
  return {
    kind: 'rag.document.ingest',
    interruption: 'retry-safe',
    async execute(context) {
      const payload = RagIngestPayloadSchema.parse(context.job.payload)
      const sourceStore = new RagSourceAssetStore(join(roots.knowledge, 'source-assets'))
      const [asset, knowledgeBase] = await Promise.all([
        sourceStore.read(payload.assetId),
        getKnowledgeBase(payload.knowledgeBaseId),
      ])
      if (!knowledgeBase) throw Object.assign(new Error(`Knowledge base ${payload.knowledgeBaseId} was not found`), { code: 'KNOWLEDGE_BASE_NOT_FOUND' })
      if (asset.sha256 !== payload.sourceSha256 || asset.size !== payload.size) throw new Error('RAG ingest payload does not match the durable source asset')
      const provider = roots.provider
      await provider.initialize()
      const existing = (await provider.getDocuments(payload.knowledgeBaseId)).find((document) => document.status === 'ready' && document.sourceSha256 === payload.sourceSha256)
      if (existing) {
        await provider.commitDocumentVisibility(payload.knowledgeBaseId, existing.id)
        return { document: existing, chunkCount: existing.chunkCount ?? 0, reused: true } as unknown as JsonValue
      }

      const metadata: DocumentMetadata = {
        id: payload.documentId,
        name: payload.fileName,
        type: payload.mediaType,
        size: payload.size,
        uploadedAt: asset.createdAt,
        status: 'processing',
        sourcePath: `source-assets/${payload.sourceSha256}`,
        sourceSha256: payload.sourceSha256,
      }
      context.checkpoint('accepted', { assetId: asset.assetId, sourceSha256: asset.sha256 })
      await provider.insertPendingDocument(payload.knowledgeBaseId, metadata)
      context.signal.throwIfAborted()
      const embeddingService = buildEmbeddingService(knowledgeBase.config)
      const cacheManager = new EmbeddingCacheManager(join(roots.cache, 'rag', 'embedding-cache'))
      const pipeline = createDocumentPipeline({
        embeddingService,
        cacheManager,
        cacheModel: `${knowledgeBase.config.embeddingConfig?.provider ?? 'default'}:${knowledgeBase.config.embeddingConfig?.model ?? 'default'}:${embeddingService.getDimensions()}`,
        ragProvider: provider,
        chunkStrategy: payload.chunkStrategy ?? knowledgeBase.config.chunkingConfig?.strategy ?? 'recursive',
        chunkSize: payload.chunkSize ?? knowledgeBase.config.chunkingConfig?.chunkSize ?? 512,
        chunkOverlap: payload.chunkOverlap ?? knowledgeBase.config.chunkingConfig?.overlap ?? 50,
        signal: context.signal,
        onProgress(stage, progress, message) {
          const ranges = { parsing: [0, 0.15], chunking: [0.15, 0.25], embedding: [0.25, 0.9], storing: [0.9, 0.99] } as const
          const [start, end] = ranges[stage]
          context.progress(start + (end - start) * (progress / 100), { stage, progress, message })
          if (stage === 'embedding' && progress > 0 && progress < 100) context.checkpoint('embedded_batch', { progress, message })
          if (progress === 100) {
            const checkpoint = stage === 'parsing' ? 'parsed' : stage === 'chunking' ? 'chunked' : stage === 'embedding' ? 'embedded' : 'indexed'
            context.checkpoint(checkpoint, { progress, message })
          }
        },
      })
      try {
        const result = await pipeline.process(await readFile(asset.path), metadata, payload.knowledgeBaseId)
        context.signal.throwIfAborted()
        const stats = await provider.getStats(payload.knowledgeBaseId)
        await recordUploadedRagDocument(payload.knowledgeBaseId, payload.fileName, stats)
        context.checkpoint('catalog_committed', { documentId: result.document.id, chunkCount: result.chunkCount })
        return {
          document: result.document,
          chunkCount: result.chunkCount,
          processingTimeMs: result.processingTimeMs,
          reused: false,
        } as unknown as JsonValue
      } catch (error) {
        if (context.signal.aborted) {
          await provider.removeDocument(payload.knowledgeBaseId, payload.documentId).catch(() => undefined)
          throw context.signal.reason
        }
        await provider.updateDocumentStatus(payload.documentId, 'error', error instanceof Error ? error.message : String(error)).catch(() => undefined)
        throw error
      } finally { cacheManager.close() }
    },
  }
}
