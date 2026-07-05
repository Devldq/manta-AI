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
import type { CreateKnowledgeBaseInput, UpdateKnowledgeBaseInput, KnowledgeBaseConfig, ChunkingConfig } from '../core/storage/knowledge-base/store.js'
import { apiSuccess, apiError, Errors } from '../core/api/error-handler.js'
import {
  getSQLiteVecProvider,
  createDocumentPipeline,
  inferMimeType,
  extractChatContext,
  buildRAGSystemPrompt,
  buildRAGUserMessage,
} from '@manta/rag'
import type { DocumentMetadata } from '@manta/rag'
import { createEmbeddingService, getAvailableEmbeddingModels } from '../core/engine/rag/embedding-service.js'
import { getEmbeddingConfig, saveEmbeddingConfig } from '../core/engine/rag/embedding-config-store'
import { getLLMConfig, getLLMProfiles } from '../core/llm/config-store'
import { profileToLLMConfig } from '../core/llm/types'
import { createAISDKModel } from '../core/llm/ai-sdk-provider'

// ─── Embedding Service 工厂 ─────────────────────────────────────
// 从 KB 配置或环境变量构建 embedding 服务，传入 rag 包

// 优先 KB 配置，其次全局持久化配置，最后环境变量
// 当 provider 为 openai 但缺少 apiKey 时，自动尝试回退到本地 Ollama
function buildEmbeddingService(kbConfig?: KnowledgeBaseConfig) {
  const gc = getEmbeddingConfig()
  const ec = kbConfig?.embeddingConfig

  let provider = ec?.provider || gc.provider || (process.env.EMBEDDING_PROVIDER as 'openai' | 'local') || 'openai'
  let model = ec?.model || gc.model || process.env.EMBEDDING_MODEL ||
    (provider === 'local' ? 'nomic-embed-text' : undefined)
  let apiKey = ec?.apiKey || gc.apiKey || process.env.OPENAI_API_KEY
  // local 不读 OPENAI_BASE_URL，交给 LocalEmbeddingService 自己的默认值
  let baseUrl = provider === 'local' ? (ec?.baseUrl || gc.baseUrl) : (ec?.baseUrl || gc.baseUrl || process.env.OPENAI_BASE_URL)
  let dimensions = ec?.dimensions || gc.dimensions || kbConfig?.dimensions || 1536

  // ── 自动回退：openai provider 但缺少 apiKey → 尝试本地 Ollama ──
  if (provider === 'openai' && !apiKey) {
    const fallback = tryFallbackToLocalOllama()
    if (fallback) {
      console.warn('[Embedding] OpenAI API key 缺失，自动回退到本地 Ollama:', fallback.model)
      provider = 'local'
      model = fallback.model
      baseUrl = fallback.baseUrl
      dimensions = fallback.dimensions
      apiKey = undefined
    } else {
      // Ollama 未检测到 embedding 模型，但仍回退到 local 以避免因缺少 key 而 crash
      // 如果 Ollama 不可用，实际 embedding 调用会给出更明确的错误信息
      console.warn('[Embedding] OpenAI API key 缺失，Ollama 未检测到 embedding 模型，尝试使用默认 local 配置')
      provider = 'local'
      model = model || 'nomic-embed-text'
      baseUrl = baseUrl || 'http://127.0.0.1:11434'
      dimensions = 768
      apiKey = undefined
    }
  }

  if (!model) {
    throw new Error(
      'Embedding model not configured. ' +
      'Set embeddingConfig.model in knowledge base config, or EMBEDDING_MODEL environment variable.'
    )
  }
  if (provider === 'openai' && !apiKey) {
    throw new Error(
      'OpenAI API key not configured. ' +
      'Set embeddingConfig.apiKey in knowledge base config, or OPENAI_API_KEY environment variable.'
    )
  }

  return createEmbeddingService(provider, { apiKey, baseUrl, model, dimensions })
}

/**
 * 尝试探测本地 Ollama 是否可用且含有 embedding 模型。
 * 同步调用（使用 child_process 的 execSync），仅在回退路径触发。
 * 返回 null 表示不可用。
 */
function tryFallbackToLocalOllama(): { model: string; baseUrl: string; dimensions: number } | null {
  try {
    const { execSync } = require('node:child_process')
    const raw = execSync('ollama list', { timeout: 3000, encoding: 'utf-8' })
    const lines = raw.trim().split('\n').slice(1) // 跳过表头
    // 优先选择名称中含 "embedding" 的模型
    const embeddingModel = lines
      .map(l => l.slice(0, 24).trim())
      .filter(Boolean)
      .find(name => name.toLowerCase().includes('embedding'))
    if (embeddingModel) {
      return { model: embeddingModel, baseUrl: 'http://127.0.0.1:11434', dimensions: 1024 }
    }
    return null
  } catch {
    return null
  }
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
        files: 50,
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
        chunkingConfig: body.chunkingConfig
          ? { ...kb.config.chunkingConfig, ...body.chunkingConfig }
          : kb.config.chunkingConfig,
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
    let streamProgress = false
    let pendingDocId: string | null = null
    let pendingKbId: string | null = null
    try {
      const { id: kbId } = request.params as { id: string }

      const kb = getKnowledgeBase(kbId)
      if (!kb) throw Errors.NOT_FOUND('知识库', kbId)

      const query = request.query as Record<string, string>
      streamProgress = query.stream === 'progress'

      const data = await request.file()
      if (!data) throw Errors.VALIDATION_ERROR('file', '未上传文件')

      const buffer = await data.toBuffer()
      const fileName = data.filename || 'unknown'
      const mimeType = data.mimetype && data.mimetype !== 'application/octet-stream'
        ? data.mimetype
        : inferMimeType(fileName)

      if (buffer.length === 0) throw Errors.VALIDATION_ERROR('file', '上传的文件为空')
      if (buffer.length > 50 * 1024 * 1024) throw Errors.VALIDATION_ERROR('file', '文件大小超过 50MB 限制')

      // 从表单字段读取分块配置，优先使用请求参数，其次 KB 配置，最后默认值
      const fields = data.fields as Record<string, { value?: string; buffer?: Buffer } | undefined>
      const reqChunkStrategy = fields?.chunkStrategy?.value as 'fixed' | 'semantic' | 'recursive' | undefined
      const reqChunkSize = fields?.chunkSize?.value ? parseInt(fields.chunkSize.value, 10) : undefined
      const reqChunkOverlap = fields?.chunkOverlap?.value ? parseInt(fields.chunkOverlap.value, 10) : undefined

      const chunkStrategy = reqChunkStrategy || kb.config.chunkingConfig?.strategy || 'recursive'
      const chunkSize = reqChunkSize || kb.config.chunkingConfig?.chunkSize || 512
      const chunkOverlap = reqChunkOverlap || kb.config.chunkingConfig?.overlap || 50

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

      // ── 先写入 processing 记录，刷新页面后也能看到正在处理的文档 ──
      const sqliteProvider = getSQLiteVecProvider()
      await sqliteProvider.insertPendingDocument(kbId, metadata)
      pendingDocId = docId
      pendingKbId = kbId

      const embeddingService = buildEmbeddingService(kb.config)
      const ragProvider = getSQLiteVecProvider()

      const sendEvent = (event: any) => {
        if (streamProgress && reply.raw.writable) {
          try {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
          } catch {
            // 客户端可能已断开，忽略
          }
        }
      }

      if (streamProgress) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
      }

      const pipeline = createDocumentPipeline({
        embeddingService,
        ragProvider,
        chunkStrategy,
        chunkSize,
        chunkOverlap,
        onProgress: (stage, progress, message) => {
          console.log(`[RAG Pipeline] ${stage}: ${progress}% - ${message}`)
          sendEvent({ type: 'progress', stage, progress, message })
        },
      })

      const result = await pipeline.process(buffer, metadata, kbId)

      const provider = getSQLiteVecProvider()
      const stats = await provider.getStats(kbId)
      updateKnowledgeBase(kbId, {
        documentCount: stats.documentCount,
        chunkCount: stats.chunkCount,
      })

      // 清除 pending 标记（addDocument 已写入 ready 记录）
      pendingDocId = null

      sendEvent({
        type: 'done',
        document: result.document,
        chunkCount: result.chunkCount,
        processingTimeMs: result.processingTimeMs,
      })

      if (streamProgress) {
        reply.raw.end()
        return
      }

      return reply.send(apiSuccess({
        document: result.document,
        chunkCount: result.chunkCount,
        processingTimeMs: result.processingTimeMs,
      }))
    } catch (err) {
      // 处理失败：更新文档状态为 error
      if (pendingDocId && pendingKbId) {
        try {
          const sqliteProvider = getSQLiteVecProvider()
          const errMsg = err instanceof Error ? err.message : String(err)
          await sqliteProvider.updateDocumentStatus(pendingDocId, 'error', errMsg)
        } catch { /* ignore status update error */ }
      }

      if (streamProgress) {
        try {
          const errorMessage = err instanceof Error ? err.message : String(err)
          if (!reply.raw.headersSent) {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no',
            })
          }
          if (reply.raw.writable) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`)
            reply.raw.end()
          }
        } catch { /* ignore */ }
        return
      }
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
  //  文档分块预览（处理前预览，不向量化、不存储）
  // ═══════════════════════════════════════════════════════════

  app.post('/api/rag/knowledge-bases/:id/chunk-preview', async (request: FastifyRequest, reply) => {
    try {
      const { id: kbId } = request.params as { id: string }
      const kb = getKnowledgeBase(kbId)
      if (!kb) throw Errors.NOT_FOUND('知识库', kbId)

      const data = await request.file()
      if (!data) throw Errors.VALIDATION_ERROR('file', '未上传文件')

      const buffer = await data.toBuffer()
      const fileName = data.filename || 'unknown'
      const mimeType = data.mimetype && data.mimetype !== 'application/octet-stream'
        ? data.mimetype
        : inferMimeType(fileName)

      if (buffer.length === 0) throw Errors.VALIDATION_ERROR('file', '上传的文件为空')
      if (buffer.length > 50 * 1024 * 1024) throw Errors.VALIDATION_ERROR('file', '文件大小超过 50MB 限制')

      // 从表单字段读取分块配置
      const fields = data.fields as Record<string, { value?: string } | undefined>
      const reqChunkStrategy = fields?.chunkStrategy?.value as 'fixed' | 'semantic' | 'recursive' | undefined
      const reqChunkSize = fields?.chunkSize?.value ? parseInt(fields.chunkSize.value, 10) : undefined
      const reqChunkOverlap = fields?.chunkOverlap?.value ? parseInt(fields.chunkOverlap.value, 10) : undefined

      const chunkStrategy = reqChunkStrategy || kb.config.chunkingConfig?.strategy || 'recursive'
      const chunkSize = reqChunkSize || kb.config.chunkingConfig?.chunkSize || 512
      const chunkOverlap = reqChunkOverlap || kb.config.chunkingConfig?.overlap || 50

      const docId = uuidv4()
      const metadata: DocumentMetadata = {
        id: docId,
        name: fileName,
        type: mimeType,
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
      }

      // 构建 pipeline（只需要解析+分块，不需要 embedding/storing）
      const pipeline = createDocumentPipeline({
        embeddingService: null as any,
        ragProvider: null as any,
        chunkStrategy,
        chunkSize,
        chunkOverlap,
      })

      const chunks = await pipeline.previewChunks(buffer, metadata)
      const preview = chunks.map(({ embedding, ...rest }) => rest)

      return reply.send(apiSuccess({
        document: { ...metadata, status: 'pending' },
        chunks: preview,
        totalChunks: chunks.length,
        config: { chunkStrategy, chunkSize, chunkOverlap },
      }))
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
  //  知识问答（流式 SSE）
  // ═══════════════════════════════════════════════════════════

  app.post('/api/rag/knowledge-bases/:id/chat', async (request: FastifyRequest, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>
      const question = body.question?.trim()

      if (!question) throw Errors.VALIDATION_ERROR('question', '问题不能为空')

      const kb = getKnowledgeBase(id)
      if (!kb) throw Errors.NOT_FOUND('知识库', id)

      // ── 1. 检索相关 chunks ──
      const provider = getSQLiteVecProvider()
      const vectorThreshold = kb.config.similarityThreshold || 0.3
      const topK = 5

      let allResults: any[] = []
      try {
        const embeddingService = buildEmbeddingService(kb.config)
        const queryEmbedding = await embeddingService.embed(question)
        allResults = await provider.vectorSearch(id, queryEmbedding, {
          topK,
          threshold: vectorThreshold,
          includeMetadata: true,
        })
      } catch (err) {
        console.warn('向量检索失败:', err)
      }

      // 补充关键词检索
      try {
        const keywordResults = await provider.search(id, question, {
          topK: topK * 2,
          threshold: 0.1,
          includeMetadata: true,
        })
        const existingIds = new Set(allResults.map((r: any) => r.chunk.id))
        for (const kr of keywordResults) {
          if (!existingIds.has(kr.chunk.id)) allResults.push(kr)
        }
      } catch { /* ignore */ }

      allResults.sort((a: any, b: any) => b.score - a.score)
      allResults = allResults.slice(0, topK)

      // ── 2. 构建 RAG 上下文 + prompt ──
      const context = extractChatContext(allResults)
      const systemPrompt = buildRAGSystemPrompt(context)
      const userMessage = buildRAGUserMessage(question, context)

      // ── 3. 选择 LLM 模型 ──
      const { streamText } = await import('ai')
      let modelConfig = getLLMConfig()

      const profileId = body.profileId as string | undefined
      if (profileId) {
        try {
          const profilesConfig = getLLMProfiles()
          const found = profilesConfig.profiles.find((p) => p.id === profileId)
          if (found) {
            modelConfig = profileToLLMConfig(found)
          }
        } catch { /* fall back to default */ }
      }

      let model
      try {
        model = await createAISDKModel(modelConfig)
      } catch (err) {
        throw new Error(`创建 AI 模型失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      // ── 4. SSE 流式输出 ──
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // 发送检索到的来源信息（含 chunk 元数据）
      reply.raw.write(`data: ${JSON.stringify({
        type: 'sources',
        sources: context.chunks.map((c) => ({
          name: c.sourceName,
          documentId: c.documentId,
          score: c.score,
          index: c.index,
          tokenEstimate: c.tokenEstimate,
        })),
      })}\n\n`)

      const result = streamText({
        model,
        system: systemPrompt,
        prompt: userMessage,
        temperature: 0.3,
      })

      let fullText = ''
      for await (const chunk of result.textStream) {
        fullText += chunk
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', text: chunk })}\n\n`)
      }

      // 发送完成信号
      reply.raw.write(`data: ${JSON.stringify({
        type: 'done',
        text: fullText,
      })}\n\n`)

      reply.raw.end()
    } catch (err: any) {
      // 如果 header 还没发送，返回 JSON 错误
      if (!reply.sent) {
        return apiError(reply, err)
      }
      // header 已发送，用 SSE 格式发送错误
      try {
        reply.raw.write(`data: ${JSON.stringify({
          type: 'error',
          error: err?.message || String(err),
        })}\n\n`)
        reply.raw.end()
      } catch { /* ignore */ }
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
      const config = getEmbeddingConfig()
      const { createDocumentParserFactory } = await import('@manta/rag')
      const factory = createDocumentParserFactory()
      const supportedTypes = factory.getSupportedMimeTypes()

      const { getAvailableEmbeddingModels: getModels } = await import('../core/engine/rag/embedding-service.js')
      const { local, openai } = await getModels()

      let globalProvider = config.provider
      let globalModel = config.model

      if (globalProvider === 'local' && local.length > 0) {
        if (!globalModel || !local.find(m => m.id === globalModel)) {
          globalModel = local[0].id
        }
      } else if (globalProvider === 'local' && local.length === 0) {
        globalProvider = 'openai'
        globalModel = openai[0]?.id ?? 'text-embedding-3-small'
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

      // LLM profiles（供问答 Tab 模型选择 + embedding 匹配）
      let llmProfiles: Array<{ id: string; name: string; model: string; isDefault?: boolean }> = []
      let embeddingProfileId: string | null = null
      try {
        const profilesConfig = getLLMProfiles()
        llmProfiles = profilesConfig.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          model: p.model,
          isDefault: p.isDefault,
        }))
        // 匹配当前 embedding 配置对应的 profile
        const ec = getEmbeddingConfig()
        const match = profilesConfig.profiles.find((p) =>
          p.model === ec.model &&
          (ec.provider === 'local' ? p.provider === 'ollama' : p.provider === 'openai' || p.provider === 'openai-compatible' || p.provider === 'anthropic')
        )
        if (match) embeddingProfileId = match.id
      } catch { /* ignore */ }

      return reply.send(apiSuccess({
        supportedFormats: supportedTypes,
        maxFileSize: '50MB',
        globalProvider,
        globalModel,
        globalConfig: config,
        availableProviders,
        llmProfiles,
        embeddingProfileId,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ─── 从 LLM profile 同步 Embedding 配置 ───
  app.post('/api/rag/embedding-config-from-profile', async (request, reply) => {
    try {
      const body = request.body as { profileId?: string; dimensions?: number }
      if (!body.profileId) {
        return reply.status(400).send({ success: false, error: 'profileId 不能为空' })
      }
      const profiles = getLLMProfiles()
      const profile = profiles.profiles.find(p => p.id === body.profileId)
      if (!profile) {
        return reply.status(404).send({ success: false, error: 'Profile 不存在' })
      }
      // ollama / lm-studio → 'local', 其余 → 'openai'
      const embeddingProvider: 'openai' | 'local' =
        profile.provider === 'ollama' || profile.provider === 'lm-studio' ? 'local' : 'openai'
      saveEmbeddingConfig({
        provider: embeddingProvider,
        model: profile.model,
        baseUrl: profile.baseUrl || undefined,
        apiKey: profile.apiKey || undefined,
        dimensions: body.dimensions ?? (embeddingProvider === 'local' ? 768 : 1536),
      })
      return reply.send(apiSuccess({ profileId: body.profileId, provider: embeddingProvider, model: profile.model }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ─── 保存全局 Embedding 配置 ───
  app.post('/api/rag/embedding-config', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const provider = body.provider as 'openai' | 'local'
      if (!provider || !['openai', 'local'].includes(provider)) {
        return reply.status(400).send({ success: false, error: 'provider 必须是 openai 或 local' })
      }
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
      if (!model) {
        return reply.status(400).send({ success: false, error: 'model 不能为空' })
      }
      const payload = {
        provider,
        model,
        baseUrl: typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : undefined,
        apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined,
        dimensions: typeof body.dimensions === 'number' ? body.dimensions : undefined,
      }
      saveEmbeddingConfig(payload)
      return reply.send(apiSuccess({ config: payload }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ─── 扫描指定 provider 的可用模型 ───
  app.get('/api/rag/embedding-models', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>
      const provider = query.provider || 'local'
      const { getAvailableEmbeddingModels: getModels } = await import('../core/engine/rag/embedding-service.js')
      const { local, openai } = await getModels()
      const models = provider === 'local' ? local : openai
      return reply.send(apiSuccess({ provider, models }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

}
