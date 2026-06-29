import type { FastifyInstance, FastifyRequest } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import {
  listKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '../core/storage/knowledge-base/store'
import type { CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput } from '../core/storage/knowledge-base/store'
import { apiSuccess, apiError, Errors } from '../core/api/error-handler'
import { createDocumentPipeline } from '../core/engine/rag/pipeline'
import { getSQLiteVecProvider } from '../core/engine/rag/providers/sqlite-vec-provider'
import { createEmbeddingService } from '../core/engine/rag/providers/embedding-service'
import { inferMimeType } from '../core/engine/rag/document-parser'
import type { DocumentMetadata, SearchOptions } from '../core/engine/rag/types'

// ─── 注册 multipart 插件 ─────────────────────────────────────

export async function ragRoutes(app: FastifyInstance) {
  // 注册 multipart 支持
  try {
    const multipartPlugin = await import('@fastify/multipart')
    const plugin = (multipartPlugin as any).default || multipartPlugin
    await app.register(plugin, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 1,
      },
    })
  } catch {
    // 可能已注册
  }

  // ═══════════════════════════════════════════════════════════
  //  知识库 CRUD
  // ═══════════════════════════════════════════════════════════

  // GET /api/rag/knowledge-bases — 获取知识库列表
  app.get('/api/rag/knowledge-bases', async (request, reply) => {
    try {
      const search = (request.query as Record<string, string>).search
      const knowledgeBases = listKnowledgeBases(search)
      return reply.send(apiSuccess({ knowledgeBases }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/rag/knowledge-bases — 创建知识库
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

      // 在 vector provider 中注册知识库
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

  // GET /api/rag/knowledge-bases/:id — 获取单个知识库
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

  // PUT /api/rag/knowledge-bases/:id — 更新知识库
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

  // DELETE /api/rag/knowledge-bases/:id — 删除知识库
  app.delete('/api/rag/knowledge-bases/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      // 删除向量库数据
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

  // GET /api/rag/knowledge-bases/:id/documents — 文档列表
  app.get('/api/rag/knowledge-bases/:id/documents', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const documents = provider.getDocuments(id)

      return reply.send(apiSuccess({ documents }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/rag/knowledge-bases/:id/documents — 上传并处理文档
  app.post('/api/rag/knowledge-bases/:id/documents', async (request: FastifyRequest, reply) => {
    try {
      const { id: kbId } = request.params as { id: string }

      const kb = getKnowledgeBase(kbId)
      if (!kb) throw Errors.NOT_FOUND('知识库', kbId)

      // 解析 multipart 文件上传
      const data = await request.file()
      if (!data) {
        throw Errors.VALIDATION_ERROR('file', '未上传文件')
      }

      const buffer = await data.toBuffer()
      const fileName = data.filename || 'unknown'
      const mimeType = data.mimetype || inferMimeType(fileName)

      if (buffer.length === 0) {
        throw Errors.VALIDATION_ERROR('file', '上传的文件为空')
      }
      if (buffer.length > 50 * 1024 * 1024) {
        throw Errors.VALIDATION_ERROR('file', '文件大小超过 50MB 限制')
      }

      // 创建文档元数据
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

      // 构建 embedding service
      const embeddingService = createEmbeddingService(
        process.env.EMBEDDING_PROVIDER as 'openai' | 'local' || 'openai',
        {
          apiKey: process.env.OPENAI_API_KEY,
          baseUrl: process.env.OPENAI_BASE_URL,
          model: process.env.EMBEDDING_MODEL,
        }
      )

      // 获取 RAG provider
      const ragProvider = getSQLiteVecProvider()

      // 创建流水线并处理文档
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

      // 更新知识库的文档计数
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

  // GET /api/rag/knowledge-bases/:id/documents/:docId — 文档详情
  app.get('/api/rag/knowledge-bases/:id/documents/:docId', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const doc = provider.getDocument(docId)
      if (!doc) throw Errors.NOT_FOUND('文档', docId)

      return reply.send(apiSuccess({ document: doc }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/rag/knowledge-bases/:id/documents/:docId — 删除文档
  app.delete('/api/rag/knowledge-bases/:id/documents/:docId', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      await provider.removeDocument(id, docId)

      // 更新统计
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

  // GET /api/rag/knowledge-bases/:id/documents/:docId/chunks — 文档分块预览
  app.get('/api/rag/knowledge-bases/:id/documents/:docId/chunks', async (request, reply) => {
    try {
      const { id, docId } = request.params as { id: string; docId: string }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()
      const doc = provider.getDocument(docId)
      if (!doc) throw Errors.NOT_FOUND('文档', docId)

      const limit = parseInt((request.query as Record<string, string>)?.limit || '50', 10)
      const chunks = provider.getDocumentChunks(docId, Math.min(limit, 200))

      // 返回不包含 embedding 的预览数据
      const preview = chunks.map(({ embedding, ...rest }) => rest)

      return reply.send(apiSuccess({ document: doc, chunks: preview, totalChunks: doc.chunkCount }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  检索
  // ═══════════════════════════════════════════════════════════

  // POST /api/rag/knowledge-bases/:id/search — 检索知识库
  app.post('/api/rag/knowledge-bases/:id/search', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>
      const query = body.query?.trim()

      if (!query) {
        throw Errors.VALIDATION_ERROR('query', '检索关键词不能为空')
      }

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      const provider = getSQLiteVecProvider()

      const searchOptions: SearchOptions = {
        topK: body.topK || kb.config.topK || 5,
        threshold: body.threshold || kb.config.similarityThreshold || 0.7,
        includeMetadata: true,
      }

      // 首先尝试向量检索
      let results = await provider.search(id, query, searchOptions)

      // 如果配置了 embedding 并且结果较少，尝试增强检索
      if (results.length < searchOptions.topK!) {
        try {
          const embeddingService = createEmbeddingService(
            process.env.EMBEDDING_PROVIDER as 'openai' | 'local' || 'openai',
            {
              apiKey: process.env.OPENAI_API_KEY,
              baseUrl: process.env.OPENAI_BASE_URL,
              model: process.env.EMBEDDING_MODEL,
            }
          )
          const queryEmbedding = await embeddingService.embed(query)
          const vectorResults = await (provider as any).vectorSearch(id, queryEmbedding, searchOptions)

          // 合并去重结果
          if (vectorResults && vectorResults.length > 0) {
            const existingIds = new Set(results.map((r) => r.chunk.id))
            for (const vr of vectorResults) {
              if (!existingIds.has(vr.chunk.id)) {
                results.push(vr)
              }
            }
            results.sort((a, b) => b.score - a.score)
            results = results.slice(0, searchOptions.topK)
          }
        } catch (err) {
          console.warn('向量检索增强失败，使用关键词匹配结果:', err)
        }
      }

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

  // GET /api/rag/knowledge-bases/:id/stats — 知识库统计
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
  //  配置查询（供前端使用）
  // ═══════════════════════════════════════════════════════════

  // GET /api/rag/config — RAG 模块配置信息
  app.get('/api/rag/config', async (_request, reply) => {
    try {
      const { createDocumentParserFactory } = await import('../core/engine/rag/document-parser')
      const factory = createDocumentParserFactory()
      const supportedTypes = factory.getSupportedMimeTypes()

      return reply.send(apiSuccess({
        supportedFormats: supportedTypes,
        maxFileSize: '50MB',
        embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',
        embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
