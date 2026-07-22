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
import { randomUUID } from 'node:crypto'
import type { AgentPublicEvent, AgentRunPhase, Job, JobEvent, JobStatus, JsonValue } from '@manta/contracts'
import type { TaskRuntime } from '@manta/task-runtime'

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
      return reply.send(apiSuccess({ deleted: true }))
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
      if (app.taskRuntime) {
        const job = latestAgentJob(app.taskRuntime, id, true)
        if (!job) return reply.status(404).send({ stopped: false })
        const expectedRunId = (request.body as { expectedRunId?: string } | undefined)?.expectedRunId
        if (expectedRunId && expectedRunId !== job.id) {
          return reply.status(409).send({
            stopped: false,
            code: 'RUN_MISMATCH',
            activeRunId: job.id,
          })
        }
        app.taskRuntime.cancel(job.id)
        return reply.send({ stopped: true, jobId: job.id, status: 'cancelling' })
      }
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
        if (app.taskRuntime) {
          const activeJob = latestAgentJob(app.taskRuntime, id, true)
          if (activeJob) {
            return reply.status(409).send({
              error: '该会话已有正在运行的 Agent',
              code: 'AGENT_RUN_ACTIVE',
              runId: activeJob.id,
              status: activeJob.status,
            })
          }
          const messageId = randomUUID()
          const job = app.taskRuntime.createJob({ kind: 'agent.run', payload: { conversationId: id, messageId, agentName: effectiveAgentName, ...(workspaceId ? { workspaceId } : {}), messages: body.messages as any }, metadata: { conversationId: id, messageId, ...(workspaceId ? { workspaceId } : {}) }, maxAttempts: 1 })
          return streamAgentJob(app.taskRuntime, job, 0, request, reply)
        } else {
          const { startAgentLoop } = await import('../core/engine/stream-handler')
          await startAgentLoop({ messages: body.messages, agentName: effectiveAgentName, conversationId: id, workspaceId })
        }
      } catch (err) {
        console.error('[ai-stream] start error:', err)
        return reply.status(500).send({ error: String(err) })
      }

      // SSE 流式响应
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Vercel-AI-UI-Message-Stream': 'v1',
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
      const onDone = () => {
        try { reply.raw.end() } catch { /* ignore */ }
      }
      if (loop) {
        loop.emitter.on('done', onDone)
        if (loop.finished) {
          try { reply.raw.end() } catch { /* ignore */ }
        }
      }

      reply.raw.on('close', () => {
        unsubscribe()
        loop?.emitter.off('done', onDone)
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // GET /api/conversations/:id/ai-stream — 重连到已有循环
  app.get('/api/conversations/:id/ai-stream', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      if (app.taskRuntime) {
        const fromSeq = parseInt((request.query as Record<string, string>).fromSeq ?? '0', 10)
        // A non-zero cursor means the client already observed this run. Allow
        // replaying its terminal tail even if the Job completed while the
        // transport was disconnected.
        const job = fromSeq > 0
          ? latestAgentJob(app.taskRuntime, id, false)
          : latestStreamingAgentJob(app.taskRuntime, id)
        if (!job) return reply.status(404).send({ error: '暂无持久化 Agent Job' })
        return streamAgentJob(app.taskRuntime, job, fromSeq, request, reply)
      }
      const { getActiveLoop, subscribeToLoop } = await import('../core/engine/loop-registry')
      const loop = getActiveLoop(id)
      if (!loop) return reply.status(404).send({ error: '暂无活跃会话' })

      const fromSeq = parseInt((request.query as Record<string, string>).fromSeq ?? '0', 10)

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Vercel-AI-UI-Message-Stream': 'v1',
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

      reply.raw.on('close', () => {
        unsubscribe()
        loop.emitter.off('done', onDone)
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}

function latestAgentJob(runtime: TaskRuntime, conversationId: string, activeOnly: boolean): Job | undefined {
  return runtime.listJobs({ kind: 'agent.run', limit: 100 }).find((job) => job.metadata.conversationId === conversationId && (!activeOnly || !['succeeded', 'failed', 'cancelled'].includes(job.status)))
}

const STREAMING_AGENT_JOB_STATUSES: JobStatus[] = [
  'queued',
  'running',
  'retry_scheduled',
  'cancelling',
]

/**
 * Refresh reconnect is only for jobs that can still emit agent-stream chunks.
 * Completed jobs and jobs paused for user/recovery input must render from the
 * persisted conversation snapshot instead of replaying their event history.
 */
export function latestStreamingAgentJob(runtime: TaskRuntime, conversationId: string): Job | undefined {
  return runtime
    .listJobs({ kind: 'agent.run', status: STREAMING_AGENT_JOB_STATUSES, limit: 100 })
    .find((job) => job.metadata.conversationId === conversationId)
}

export function streamAgentJob(runtime: TaskRuntime, job: Job, fromSeq: number, _request: any, reply: any): void {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Vercel-AI-UI-Message-Stream': 'v1',
    'X-Manta-Job-Id': job.id,
  })
  let cursor = Math.max(0, fromSeq)
  let ended = false
  let publicTerminalSeen = false
  const writePublicEvent = (event: JobEvent, type: AgentPublicEvent['type'], phase: AgentRunPhase, data: JsonValue = {}) => {
    const publicEvent: AgentPublicEvent = {
      schemaVersion: 1,
      runId: job.id,
      conversationId: String(job.metadata.conversationId ?? ''),
      messageId: `${job.id}:assistant`,
      seq: event.seq,
      timestamp: event.timestamp,
      phase,
      type,
      data,
    }
    reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({
      type: 'data-agent-run',
      id: `${job.id}:${event.seq}`,
      data: publicEvent,
    })}\n\n`)
  }
  const write = (event: JobEvent) => {
    if (ended || event.seq <= cursor) return
    cursor = event.seq
    if (event.type === 'log' && event.data && typeof event.data === 'object' && !Array.isArray(event.data) && event.data.channel === 'agent.stream') {
      reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event.data.chunk)}\n\n`)
    }
    if (event.type === 'log' && event.data && typeof event.data === 'object' && !Array.isArray(event.data) && event.data.channel === 'agent.public') {
      const publicEvent: Record<string, unknown> | undefined = event.data.event && typeof event.data.event === 'object' && !Array.isArray(event.data.event)
        ? { ...event.data.event as Record<string, unknown>, seq: event.seq }
        : undefined
      if (publicEvent) {
        if (['run.completed', 'run.cancelled', 'run.failed'].includes(String(publicEvent.type))) publicTerminalSeen = true
      }
      reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({
        type: 'data-agent-run',
        id: `${job.id}:${event.seq}`,
        data: publicEvent,
      })}\n\n`)
    }
    if (event.type === 'job.cancellation_requested') {
      writePublicEvent(event, 'run.cancellation_requested', 'cancelling')
    }
    if (['job.succeeded', 'job.failed', 'job.cancelled', 'job.recovery_required'].includes(event.type)) {
      if (!publicTerminalSeen) {
        if (event.type === 'job.cancelled') writePublicEvent(event, 'run.cancelled', 'cancelled')
        if (event.type === 'job.failed' || event.type === 'job.recovery_required') {
          writePublicEvent(event, 'run.failed', 'failed', event.data)
        }
        if (event.type === 'job.succeeded') writePublicEvent(event, 'run.completed', 'completed')
        publicTerminalSeen = true
      }
      if (event.type === 'job.failed' || event.type === 'job.recovery_required') reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({ type: 'error', errorText: event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data.message ?? event.data.reason ?? 'Agent Job failed' : 'Agent Job failed' })}\n\n`)
      ended = true
      unsubscribe()
      reply.raw.end()
    }
  }
  let unsubscribe = () => {}
  unsubscribe = runtime.subscribeFrom(job.id, cursor, write)
  if (ended) unsubscribe()
  const snapshot = runtime.getJob(job.id)
  if (!ended && snapshot && ['succeeded', 'failed', 'cancelled'].includes(snapshot.status)) { ended = true; unsubscribe(); reply.raw.end() }
  // IncomingMessage.close means that the request body has completed; for a
  // POST SSE request that can happen while the response is still streaming.
  // Only the ServerResponse close event represents the response/client going
  // away and is therefore the correct point to detach the job subscription.
  reply.raw.on('close', () => { unsubscribe() })
}
