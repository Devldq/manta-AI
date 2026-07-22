import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { z } from 'zod'
import type { Job, JobStatus, JsonValue } from '@manta/contracts'
import Manta from '@manta/sdk'

const MessageSchema = z.object({
  messageId: z.string().min(1),
  role: z.enum(['ROLE_USER', 'ROLE_AGENT']),
  parts: z.array(z.union([z.object({ text: z.string() }), z.object({ data: z.unknown() })])).min(1),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
const SendSchema = z.object({
  message: MessageSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
})

export interface A2AServerOptions {
  manta: Manta
  token?: string
  host?: '127.0.0.1' | '::1'
  port?: number
}

export interface A2AServerHandle {
  app: FastifyInstance
  endpoint: string
  token: string
  close(): Promise<void>
}

export async function startA2AServer(options: A2AServerOptions): Promise<A2AServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const token = options.token ?? randomBytes(32).toString('base64url')
  const app = Fastify({ logger: false })
  app.addContentTypeParser('application/a2a+json', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, JSON.parse(String(body))) } catch (error) { done(error as Error, undefined) }
  })
  let endpoint = ''

  app.addHook('onRequest', async (request, reply) => {
    const version = request.headers['a2a-version']
    if (version && version !== '1.0') return a2aError(reply, 400, 'VERSION_NOT_SUPPORTED', `Unsupported A2A version: ${version}`)
    if (request.url.split('?')[0] === '/.well-known/agent-card.json') return
    const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!provided || !secretEquals(token, provided)) return a2aError(reply, 401, 'UNAUTHENTICATED', 'A local A2A bearer token is required')
  })

  app.get('/.well-known/agent-card.json', async (_request, reply) => {
    const card = agentCard(endpoint)
    return reply.header('content-type', 'application/a2a+json').header('cache-control', 'private, max-age=300').header('etag', '"manta-a2a-0.1.0"').send(card)
  })

  app.post('/message::send', async (request, reply) => {
    try {
      const input = SendSchema.parse(request.body)
      const response = await sendMessage(options.manta, input)
      return reply.header('content-type', 'application/a2a+json').send(response)
    } catch (error) { return requestError(reply, error) }
  })

  app.post('/message::stream', async (request, reply) => {
    try {
      const input = SendSchema.parse(request.body)
      const response = await sendMessage(options.manta, input)
      if ('message' in response) return streamSingle(reply, response)
      return streamJob(options.manta, response.task.id, reply, response.task)
    } catch (error) { return requestError(reply, error) }
  })

  app.get('/tasks/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return reply.header('content-type', 'application/a2a+json').send({ task: await taskSnapshot(options.manta, id) })
    } catch (error) { return taskError(reply, error) }
  })

  app.get('/tasks', async (request, reply) => {
    const query = request.query as { pageSize?: string; pageToken?: string; status?: string }
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 50)))
    const jobs = await options.manta.jobs.list({ limit: pageSize, before: query.pageToken || undefined })
    const tasks = await Promise.all(jobs.data.filter((job) => !query.status || a2aState(job.status) === query.status).map((job) => taskFromJob(options.manta, job)))
    return reply.header('content-type', 'application/a2a+json').send({ tasks, totalSize: tasks.length, pageSize, nextPageToken: jobs.nextCursor ?? '' })
  })

  app.post('/tasks/*', async (request, reply) => {
    const match = request.url.split('?')[0]?.match(/^\/tasks\/([^/]+):(cancel|subscribe)$/)
    if (!match) return a2aError(reply, 400, 'UNSUPPORTED_OPERATION', 'Unsupported Task operation')
    const id = decodeURIComponent(match[1])
    try {
      if (match[2] === 'cancel') {
        const job = await options.manta.jobs.retrieve(id)
        if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return a2aError(reply, 400, 'TASK_NOT_CANCELABLE', `Task ${id} is already terminal`)
        const cancelled = await options.manta.jobs.cancel(id)
        return reply.header('content-type', 'application/a2a+json').send({ task: await taskFromJob(options.manta, cancelled) })
      }
      const task = await taskSnapshot(options.manta, id)
      if (isTerminalTask(task.status.state)) return a2aError(reply, 400, 'UNSUPPORTED_OPERATION', 'Cannot subscribe to a terminal Task')
      return streamJob(options.manta, id, reply, task)
    } catch (error) { return taskError(reply, error) }
  })

  await app.listen({ host, port: options.port ?? 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('A2A server did not bind a TCP port')
  endpoint = `http://${host === '::1' ? '[::1]' : host}:${address.port}`
  return { app, endpoint, token, close: () => app.close() }
}

async function sendMessage(manta: Manta, input: z.infer<typeof SendSchema>): Promise<{ message: object } | { task: A2ATask }> {
  if (input.message.role !== 'ROLE_USER') throw new Error('Only ROLE_USER messages can start work')
  const metadata = { ...(input.message.metadata ?? {}), ...(input.metadata ?? {}) }
  const text = input.message.parts.filter((part): part is { text: string } => 'text' in part).map((part) => part.text).join('\n').trim()
  const skillId = typeof metadata.skillId === 'string' ? metadata.skillId : 'agent-run'
  if (skillId === 'knowledge-search') {
    const knowledgeBaseId = String(metadata.knowledgeBaseId ?? '')
    if (!knowledgeBaseId || !text) throw new Error('knowledge-search requires metadata.knowledgeBaseId and a text part')
    const result = await manta.knowledge.search({ knowledgeBaseId, query: text }) as JsonValue
    return { message: { messageId: input.message.messageId, role: 'ROLE_AGENT', contextId: input.message.contextId, parts: [{ text: 'Manta local knowledge search completed.' }, { data: result }] } }
  }
  const conversationId = String(metadata.conversationId ?? '')
  if (!conversationId || !text) throw new Error('agent-run requires metadata.conversationId and a text part')
  const submitted = await manta.agents.run({ conversationId, prompt: text }, { idempotencyKey: input.message.messageId }) as { data: Job }
  return { task: await taskFromJob(manta, submitted.data, input.message.contextId, input.message) }
}

interface A2ATask {
  id: string
  contextId?: string
  status: { state: string; timestamp: string; message?: object }
  history?: object[]
  artifacts?: object[]
  metadata?: Record<string, unknown>
}

async function taskSnapshot(manta: Manta, id: string): Promise<A2ATask> { return taskFromJob(manta, await manta.jobs.retrieve(id)) }

async function taskFromJob(manta: Manta, job: Job, contextId?: string, initialMessage?: object): Promise<A2ATask> {
  const task: A2ATask = {
    id: job.id,
    ...(contextId || typeof job.metadata.contextId === 'string' ? { contextId: contextId ?? String(job.metadata.contextId) } : {}),
    status: { state: a2aState(job.status), timestamp: job.updatedAt },
    ...(initialMessage ? { history: [initialMessage] } : {}),
    metadata: { mantaJobKind: job.kind, mantaAttempt: job.attempt, mantaEventSeq: job.eventSeq },
  }
  if (job.status === 'succeeded') {
    const artifacts = await manta.jobs.artifacts(job.id)
    task.artifacts = [
      { artifactId: `${job.id}:result`, name: 'Manta Job Result', parts: [{ data: job.result ?? null }] },
      ...artifacts.data.map((artifact: any) => ({ artifactId: artifact.id, name: artifact.name, parts: [{ data: artifact }] })),
    ]
  }
  if (job.error) task.status.message = { messageId: `${job.id}:error`, role: 'ROLE_AGENT', parts: [{ text: job.error.message }] }
  return task
}

function a2aState(status: JobStatus): string {
  const states: Record<JobStatus, string> = {
    queued: 'TASK_STATE_SUBMITTED', running: 'TASK_STATE_WORKING', waiting_for_input: 'TASK_STATE_INPUT_REQUIRED',
    retry_scheduled: 'TASK_STATE_SUBMITTED', recovery_required: 'TASK_STATE_INPUT_REQUIRED', cancelling: 'TASK_STATE_WORKING',
    cancelled: 'TASK_STATE_CANCELED', succeeded: 'TASK_STATE_COMPLETED', failed: 'TASK_STATE_FAILED',
  }
  return states[status]
}

function streamSingle(reply: FastifyReply, value: unknown): void {
  reply.hijack(); reply.raw.statusCode = 200; reply.raw.setHeader('content-type', 'text/event-stream'); reply.raw.end(`data: ${JSON.stringify(value)}\n\n`)
}

async function streamJob(manta: Manta, jobId: string, reply: FastifyReply, initial: A2ATask): Promise<void> {
  reply.hijack()
  const response = reply.raw
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.setHeader('cache-control', 'no-cache')
  response.flushHeaders()
  response.write(`data: ${JSON.stringify({ task: initial })}\n\n`)
  const snapshot = await manta.jobs.retrieve(jobId)
  if (!['succeeded', 'failed', 'cancelled'].includes(snapshot.status)) {
    for await (const event of manta.jobs.events(jobId, { afterSeq: snapshot.eventSeq })) {
      const job = await manta.jobs.retrieve(jobId)
      const final = ['succeeded', 'failed', 'cancelled'].includes(job.status)
      response.write(`data: ${JSON.stringify({ statusUpdate: { taskId: jobId, status: { state: a2aState(job.status), timestamp: event.timestamp }, final } })}\n\n`)
      if (final) break
    }
  }
  response.write(`data: ${JSON.stringify({ task: await taskSnapshot(manta, jobId) })}\n\n`)
  response.end()
}

function agentCard(endpoint: string) {
  return {
    name: 'Manta Local Knowledge Assistant',
    description: 'A local-only personal knowledge retrieval and durable Agent service owned by the Manta Desktop application.',
    supportedInterfaces: [{ url: endpoint, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
    provider: { organization: 'Manta AI' },
    version: '0.1.0',
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { localBearer: { httpAuthSecurityScheme: { scheme: 'bearer', bearerFormat: 'opaque' } } },
    security: [{ localBearer: [] }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      { id: 'knowledge-search', name: 'Local Knowledge Search', description: 'Search an explicitly selected local Manta knowledge base with citations.', tags: ['knowledge', 'rag', 'local'], examples: ['Search my local notes for the deployment decision.'], inputModes: ['text/plain'], outputModes: ['application/json'] },
      { id: 'agent-run', name: 'Durable Local Agent', description: 'Run a Manta Agent as a durable Job that survives client disconnects.', tags: ['agent', 'job', 'local'], examples: ['Organize the research in this conversation.'], inputModes: ['text/plain'], outputModes: ['text/plain', 'application/json'] },
    ],
  }
}

function requestError(reply: FastifyReply, error: unknown) { return a2aError(reply, 400, 'INVALID_ARGUMENT', error instanceof Error ? error.message : String(error)) }
function taskError(reply: FastifyReply, error: unknown) { return a2aError(reply, 404, 'TASK_NOT_FOUND', error instanceof Error ? error.message : String(error)) }
function a2aError(reply: FastifyReply, code: number, reason: string, message: string) {
  return reply.status(code).header('content-type', 'application/a2a+json').send({ error: { code, status: reason === 'TASK_NOT_FOUND' ? 'NOT_FOUND' : code === 401 ? 'UNAUTHENTICATED' : 'FAILED_PRECONDITION', message, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'a2a-protocol.org' }] } })
}
function secretEquals(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
function isTerminalTask(state: string): boolean { return ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'].includes(state) }
