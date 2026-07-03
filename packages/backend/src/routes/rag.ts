/**
 * RAG REST API 路由 — Fastify 插件
 *
 * Embedding 模型配置由调用方传入（KB 配置或环境变量），
 * 再传入 @manta/rag 包的核心检索/存储能力。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import {
  listKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '../core/storage/knowledge-base/store.js'
import type { CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput, KnowledgeBaseConfig } from '../core/storage/knowledge-base/store.js'
import { apiSuccess, apiError, Errors } from '../core/api/error-handler.js'
import { getSQLiteVecProvider, createDocumentPipeline, inferMimeType } from '@manta/rag'
import type { DocumentMetadata } from '@manta/rag'
import { createEmbeddingService, getAvailableEmbeddingModels } from '../core/engine/rag/embedding-service.js'

// ─── Embedding Service 工厂 ─────────────────────────────────────
// 从 KB 配置或环境变量构建 embedding 服务，传入 rag 包

function buildEmbeddingService(kbConfig?: KnowledgeBaseConfig) {
  const ec = kbConfig?.embeddingConfig
  const provider = ec?.provider || (process.env.EMBEDDING_PROVIDER as 'openai' | 'local') || 'openai'
  const model = ec?.model || process.env.EMBEDDING_MODEL
  const apiKey = ec?.apiKey || process.env.OPENAI_API_KEY
  const baseUrl = ec?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const dimensions = ec?.dimensions || kbConfig?.dimensions || 1536

  if (!model) {
    throw new Error(
      'Embedding model not configured. ' +
      'Set embeddingConfig.model in knowledge base config, or EMBEDDING_MODEL environment variable.'
    )
  }
  if (!apiKey) {
    throw new Error(
      'OpenAI API key not configured. ' +
      'Set embeddingConfig.apiKey in knowledge base config, or OPENAI_API_KEY environment variable.'
    )
  }

  return createEmbeddingService(provider, { apiKey, baseUrl, model, dimensions })
}

// ─── 注册插件 ─────────────────────────────────────────────────

export async function ragRoutes(app: FastifyInstance) {
  // 注册 multipart 支持
  try {
    const multipartPlugin = await import('@fastify/multipart')
    const plugin = (multipartPlugin as any).default || multipartPlugin
    await app.register(plugin, {
      limits: {
        fileSize: 50 * 1024 * 1024,
        files: 1,
      },
    })
  } catch {
    // 可能已注册
  }

  // ═══════════════════════════════════════════════════════════
  //  知识库 CRUD
  // ═══════════════════════════════════════════════════════════

  app.get('/api/rag/knowledge-bases', async (request, reply) => {
    try {
      const search = (request.query as Record<string, string>).search
      const knowledgeBases = listKnowledgeBases(search)
      return reply.send(apiSuccess({ knowledgeBases }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.post('/api/rag/knowledge-bases', async (request, reply) => {
    try {
      const body = request.body as Record<string, any>
      if (!body.name?.trim()) {
        throw Errors.VALIDATION_ERROR('name', '知识库名称不能为空')
      }

      const input: CreateKnowledgeBaseInput = {
        name: body.name.trim(),
        description: body.description?.trim(),
        providerId: body.providerId,
        config: body.config,
      }

      const knowledgeBase = createKnowledgeBase(input)

      try {
        const provider = getSQLiteVecProvider()
        await provider.createKnowledgeBase(knowledgeBase.id, knowledgeBase.name, knowledgeBase.config)
      } catch (err) {
        console.warn('向量库注册失败（不影响知识库创建）:', err)
      }

      return reply.status(201).send(apiSuccess({ knowledgeBase }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.get('/api/rag/knowledge-bases/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const knowledgeBase = getKnowledgeBase(id)
      if (!knowledgeBase) throw Errors.NOT_FOUND('知识库', id)
      return reply.send(apiSuccess({ knowledgeBase }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.put('/api/rag/knowledge-bases/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>

      const patch: UpdateKnowledgeBaseInput = {}
      if (body.name !== undefined) patch.name = body.name
      if (body.description !== undefined) patch.description = body.description
      if (body.providerId !== undefined) patch.providerId = body.providerId
      if (body.config !== undefined) patch.config = body.config
      if (body.documentCount !== undefined) patch.documentCount = body.documentCount
      if (body.chunkCount !== undefined) patch.chunkCount = body.chunkCount

      const knowledgeBase = updateKnowledgeBase(id, patch)
      if (!knowledgeBase) throw Errors.NOT_FOUND('知识库', id)
      return reply.send(apiSuccess({ knowledgeBase }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.patch('/api/rag/knowledge-bases/:id/config', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const newConfig = {
        ...kb.config,
        ...body,
        embeddingConfig: body.embeddingConfig
          ? { ...kb.config.embeddingConfig, ...body.embeddingConfig }
          : kb.config.embeddingConfig,
        hybridSearch: body.hybridSearch
          ? { ...kb.config.hybridSearch, ...body.hybridSearch }
          : kb.config.hybridSearch,
      }

      const updated = updateKnowledgeBase(id, { config: newConfig })
      return reply.send(apiSuccess({ knowledgeBase: updated }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.delete('/api/rag/knowledge-bases/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      try {
        const provider = getSQLiteVecProvider()
        await provider.deleteKnowledgeBase(id)
      } catch (err) {
        console.warn('向量库删除失败:', err)
      }

      const deleted = deleteKnowledgeBase(id)
      if (!deleted) throw Errors.NOT_FOUND('知识库', id)
      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  文档管理
  // ═══════════════════════════════════════════════════════════

  app.get('/api/rag/knowledge-bases/:id/documents', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const documents = await provider.getDocuments(id)
      return reply.send(apiSuccess({ documents }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.post('/api/rag/knowledge-bases/:id/documents', async (request: FastifyRequest, reply) => {
    try {
      const { id: kbId } = request.params as { id: string }

      const kb = getKnowledgeBase(kbId)
      if (!kb) throw Errors.NOT_FOUND('知识库', kbId)

      const data = await request.file()
      if (!data) throw Errors.VALIDATION_ERROR('file', '未上传文件')

      const buffer = await data.toBuffer()
      const fileName = data.filename || 'unknown'
      const mimeType = data.mimetype || inferMimeType(fileName)

      if (buffer.length === 0) throw Errors.VALIDATION_ERROR('file', '上传的文件为空')
      if (buffer.length > 50 * 1024 * 1024) throw Errors.VALIDATION_ERROR('file', '文件大小超过 50MB 限制')

      const docId = uuidv4()
      const now = new Date().toISOString()
      const metadata: DocumentMetadata = {
        id: docId,
        name: fileName,
        type: mimeType,
        size: buffer.length,
        uploadedAt: now,
        status: 'processing',
      }

      // 从 KB 配置 / 环境变量构建 embedding 服务，传入 pipeline
      const embeddingService = buildEmbeddingService(kb.config)
      const ragProvider = getSQLiteVecProvider()

      const pipeline = createDocumentPipeline({
        embeddingService,
        ragProvider,
        chunkStrategy: 'recursive',
        chunkSize: 1000,
        chunkOverlap: 200,
        onProgress: (stage, progress, message) => {
          console.log(`[RAG Pipeline] ${stage}: ${progress}% - ${message}`)
        },
      })

      const result = await pipeline.process(buffer, metadata, kbId)

      const provider = getSQLiteVecProvider()
      const stats = await provider.getStats(kbId)
      updateKnowledgeBase(kbId, {
        documentCount: stats.documentCount,
        chunkCount: stats.chunkCount,
      })

      return reply.send(apiSuccess({
        document: result.document,
        chunkCount: result.chunkCount,
        processingTimeMs: result.processingTimeMs,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.get('/api/rag/knowledge-bases/:id/documents/:docId', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const doc = await provider.getDocument(docId)
      if (!doc) throw Errors.NOT_FOUND('文档', docId)

      return reply.send(apiSuccess({ document: doc }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  app.delete('/api/rag/knowledge-bases/:id/documents/:docId', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      await provider.removeDocument(id, docId)

      const stats = await provider.getStats(id)
      updateKnowledgeBase(id, {
        documentCount: stats.documentCount,
        chunkCount: stats.chunkCount,
      })

      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  文档预览
  // ═══════════════════════════════════════════════════════════

  app.get('/api/rag/knowledge-bases/:id/documents/:docId/chunks', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const doc = await provider.getDocument(docId)
      if (!doc) throw Errors.NOT_FOUND('文档', docId)

      const limit = parseInt((request.query as Record<string, string>)?.limit || '50', 10)
      const chunks = await provider.getDocumentChunks(docId, Math.min(limit, 200))
      const preview = chunks.map(({ embedding, ...rest }) => rest)

      return reply.send(apiSuccess({ document: doc, chunks: preview, totalChunks: doc.chunkCount }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  检索
  // ═══════════════════════════════════════════════════════════

  app.post('/api/rag/knowledge-bases/:id/search', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>
      const query = body.query?.trim()

      if (!query) throw Errors.VALIDATION_ERROR('query', '检索关键词不能为空')

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()

      const vectorThreshold = body.threshold || kb.config.similarityThreshold || 0.3
      const keywordThreshold = 0.1
      const topK = body.topK || kb.config.topK || 5

      // ── 主检索：向量语义检索（embedding 由外部配置传入） ──
      let results: any[] = []
      try {
        const embeddingService = buildEmbeddingService(kb.config)
        const queryEmbedding = await embeddingService.embed(query)
        results = await provider.vectorSearch(id, queryEmbedding, {
          topK,
          threshold: vectorThreshold,
          includeMetadata: true,
        })
      } catch (err) {
        console.warn('向量检索失败，回退到关键词匹配:', err)
      }

      // ── 补充：关键词匹配 ──
      try {
        const keywordResults = await provider.search(id, query, {
          topK: topK * 2,
          threshold: keywordThreshold,
          includeMetadata: true,
        })
        const existingIds = new Set(results.map((r: any) => r.chunk.id))
        for (const kr of keywordResults) {
          if (!existingIds.has(kr.chunk.id)) {
            results.push(kr)
          }
        }
      } catch (err) {
        console.warn('关键词匹配补充失败:', err)
      }

      results.sort((a: any, b: any) => b.score - a.score)
      results = results.slice(0, topK)

      return reply.send(apiSuccess({
        query,
        results,
        totalResults: results.length,
        knowledgeBase: { id: kb.id, name: kb.name },
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  统计
  // ═══════════════════════════════════════════════════════════

  app.get('/api/rag/knowledge-bases/:id/stats', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const stats = await provider.getStats(id)

      return reply.send(apiSuccess({
        knowledgeBase: { id: kb.id, name: kb.name },
        stats,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  配置查询（供前端使用）— 动态读取 ollama list
  // ═══════════════════════════════════════════════════════════

  app.get('/api/rag/config', async (_request, reply) => {
    try {
      const { createDocumentParserFactory } = await import('@manta/rag')
      const factory = createDocumentParserFactory()
      const supportedTypes = factory.getSupportedMimeTypes()

      const { getAvailableEmbeddingModels: getModels } = await import('../core/engine/rag/embedding-service.js')
      const { local, openai } = await getModels()

      let globalProvider = process.env.EMBEDDING_PROVIDER || 'openai'
      let globalModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

      if (process.env.EMBEDDING_PROVIDER === 'local' && local.length > 0) {
        globalModel = local[0].id
      } else if (globalProvider === 'local' && local.length === 0) {
        globalProvider = 'openai'
        globalModel = 'text-embedding-3-small'
      }

      const availableProviders: Array<{
        id: string
        name: string
        models: Array<{ id: string; name: string; dimensions?: number }>
      }> = []

      if (openai.length > 0) {
        availableProviders.push({ id: 'openai', name: 'OpenAI', models: openai })
      }
      if (local.length > 0) {
        availableProviders.push({
          id: 'local',
          name: 'Ollama (本地)',
          models: local.map((m) => ({ id: m.id, name: m.name })),
        })
      }
      if (availableProviders.length === 0) {
        availableProviders.push({ id: 'openai', name: 'OpenAI', models: openai })
      }

      return reply.send(apiSuccess({
        supportedFormats: supportedTypes,
        maxFileSize: '50MB',
        globalProvider,
        globalModel,
        availableProviders,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
