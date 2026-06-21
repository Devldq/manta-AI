import type { FastifyInstance } from 'fastify'
import {
  getConversation,
  deleteConversation,
  updateConversationTitle,
  updateConversationAgent,
} from '../core/storage/conversation/store'
import {
  getWorkspaceConversation,
  deleteWorkspaceConversation,
  updateWorkspaceConversationTitle,
  updateWorkspaceConversation,
} from '../core/storage/workspace/store'
import type { ConversationType } from '../core/types'
import { apiSuccess, apiError, apiHandler, Errors } from '../core/api/error-handler'
import { addMessage } from '../core/services/conversation.service'
import { parseAtMentions } from '../core/engine/at-mention-parser'
import { listApps } from '../core/storage/app/store'

export async function conversationDetailRoutes(app: FastifyInstance) {
  // GET /api/conversations/:id — 获取单个会话
  app.get('/api/conversations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const query = request.query as { type?: string; workspaceId?: string }
      const type = (query.type as ConversationType) || 'global'
      const workspaceId = query.workspaceId

      let conv = null
      if (type === 'workspace' && workspaceId) {
        conv = getWorkspaceConversation(workspaceId, id)
      } else {
        conv = getConversation(id)
      }
      if (!conv) return reply.status(404).send({ error: '会话不存在' })
      return reply.send({ conversation: conv })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // DELETE /api/conversations/:id — 删除会话
  app.delete('/api/conversations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const query = request.query as { type?: string; workspaceId?: string }
      const type = (query.type as ConversationType) || 'global'
      const workspaceId = query.workspaceId

      let ok = false
      if (type === 'workspace' && workspaceId) {
        ok = deleteWorkspaceConversation(workspaceId, id)
      } else {
        ok = deleteConversation(id)
      }
      if (!ok) return reply.status(404).send({ error: '会话不存在' })
      return reply.send({ ok: true })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // PATCH /api/conversations/:id — 更新会话标题
  app.patch('/api/conversations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const query = request.query as { type?: string; workspaceId?: string }
      const type = (query.type as ConversationType) || 'global'
      const workspaceId = query.workspaceId
      const body = request.body as { title?: string }

      if (!body.title?.trim()) {
        return reply.status(400).send({ error: 'title 不能为空' })
      }

      let conv = null
      if (type === 'workspace' && workspaceId) {
        conv = updateWorkspaceConversationTitle(workspaceId, id, body.title.trim())
      } else {
        conv = updateConversationTitle(id, body.title.trim())
      }
      if (!conv) return reply.status(404).send({ error: '会话不存在' })
      return reply.send({ conversation: conv })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/conversations/:id/messages — 发送消息（支持@调用）
  app.post('/api/conversations/:id/messages', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const apps = listApps()
      const mentions = parseAtMentions((body.content as string) || '', apps)

      if (mentions.length > 0 && !body.agentAppId) {
        body.agentAppId = mentions[0].agentAppId
      }

      const result = addMessage(id, body)
      if (!result) {
        throw Errors.NOT_FOUND('会话', id)
      }

      const data = apiHandler(async () => ({
        conversation: result.conversation,
        message: result.message,
        mentions,
      }))

      return reply.send(await data)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PATCH /api/conversations/:id/agent — 切换会话的 Agent
  app.patch('/api/conversations/:id/agent', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const query = request.query as { type?: string; workspaceId?: string }
      const type = (query.type as ConversationType) || 'global'
      const workspaceId = query.workspaceId
      const body = request.body as { agentName?: string }

      if (!body.agentName?.trim()) {
        return reply.status(400).send({ error: 'agentName 不能为空' })
      }

      let conv = null
      if (type === 'workspace' && workspaceId) {
        conv = getWorkspaceConversation(workspaceId, id)
        if (conv) {
          conv.agentName = body.agentName.trim()
          conv.updatedAt = new Date().toISOString()
          updateWorkspaceConversation(workspaceId, id, conv)
        }
      } else {
        conv = updateConversationAgent(id, body.agentName.trim())
      }

      if (!conv) return reply.status(404).send({ error: '会话不存在' })
      return reply.send({ conversation: conv })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/conversations/:id/stop — 停止 Agent Loop
  app.post('/api/conversations/:id/stop', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { stopLoop } = await import('../core/engine/loop-registry')
      const stopped = stopLoop(id)
      return reply.status(stopped ? 200 : 404).send({ stopped })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // GET /api/conversations/:id/context — 上下文状态快照
  app.get('/api/conversations/:id/context', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const conv = getConversation(id)
      if (!conv) return reply.status(404).send({ error: '会话不存在' })

      const totalInputTokens = conv.messages.reduce((s, m) => s + (m.usage?.inputTokens ?? 0), 0)
      const totalOutputTokens = conv.messages.reduce((s, m) => s + (m.usage?.outputTokens ?? 0), 0)

      return reply.send({
        conversationId: id,
        summary: {
          title: conv.title,
          agentName: conv.agentName,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          userMsgCount: conv.messages.filter(m => m.role === 'user').length,
          assistantMsgCount: conv.messages.filter(m => m.role === 'assistant').length,
          toolCallCount: conv.messages.flatMap(m => m.toolCalls ?? []).length,
          totalInputTokens,
          totalOutputTokens,
          totalMessages: conv.messages.length,
        },
        systemPrompt: { totalChars: 0, totalEstimatedTokens: 0, pipes: [] },
        steps: [],
        perTurn: [],
        compactionSummary: undefined,
        totalEstimatedTokens: totalInputTokens + totalOutputTokens,
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/conversations/:id/ai-stream — 启动 Agent Loop SSE 流
  app.post('/api/conversations/:id/ai-stream', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const query = request.query as { type?: string; workspaceId?: string }
      const type = (query.type as ConversationType) || 'global'
      const workspaceId = query.workspaceId

      let conv = null
      if (type === 'workspace' && workspaceId) {
        conv = getWorkspaceConversation(workspaceId, id)
      } else {
        conv = getConversation(id)
      }
      if (!conv) return reply.status(404).send({ error: '会话不存在' })

      const body = request.body as {
        messages: Array<{ role: string; content?: string }>
        agentName?: string
      }
      if (!body.messages?.length) return reply.status(400).send({ error: 'messages 不能为空' })

      const effectiveAgentName = body.agentName || conv.agentName

      try {
        const { startAgentLoop } = await import('../core/engine/stream-handler')
        await startAgentLoop({
          messages: body.messages,
          agentName: effectiveAgentName,
          conversationId: id,
          workspaceId,
        })
      } catch (err) {
        console.error('[ai-stream] start error:', err)
        return reply.status(500).send({ error: String(err) })
      }

      // SSE 流式响应
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      const { subscribeToLoop, getActiveLoop } = await import('../core/engine/loop-registry')
      const encoder = new TextEncoder()

      const unsubscribe = subscribeToLoop(id, 0, (event) => {
        try {
          const msg = `id: ${event.seq}\n${event.data}\n`
          reply.raw.write(encoder.encode(msg))
        } catch {
          unsubscribe()
        }
      })

      const loop = getActiveLoop(id)
      if (loop) {
        const onDone = () => {
          try { reply.raw.end() } catch { /* ignore */ }
        }
        loop.emitter.on('done', onDone)
        if (loop.finished) {
          try { reply.raw.end() } catch { /* ignore */ }
        }
      }

      request.raw.on('close', () => {
        unsubscribe()
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // GET /api/conversations/:id/ai-stream — 重连到已有循环
  app.get('/api/conversations/:id/ai-stream', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { getActiveLoop, subscribeToLoop } = await import('../core/engine/loop-registry')
      const loop = getActiveLoop(id)
      if (!loop) return reply.status(404).send({ error: '暂无活跃会话' })

      const fromSeq = parseInt((request.query as Record<string, string>).fromSeq ?? '0', 10)

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      const encoder = new TextEncoder()
      const unsubscribe = subscribeToLoop(id, fromSeq, (event) => {
        try {
          const msg = `id: ${event.seq}\n${event.data}\n`
          reply.raw.write(encoder.encode(msg))
        } catch {
          unsubscribe()
        }
      })

      const onDone = () => {
        try { reply.raw.end() } catch { /* ignore */ }
      }
      loop.emitter.on('done', onDone)
      if (loop.finished) {
        try { reply.raw.end() } catch { /* ignore */ }
      }

      request.raw.on('close', () => {
        unsubscribe()
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
