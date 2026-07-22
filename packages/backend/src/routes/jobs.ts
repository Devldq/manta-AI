import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { CreateJobSchema, JobRecoveryDecisionSchema, JobStatusSchema, JsonValueSchema, type JobEvent } from '@manta/contracts'
import type { TaskRuntime } from '@manta/task-runtime'
import { z } from 'zod'

export interface JobRoutesOptions {
  runtime: TaskRuntime
}

const JobIdParamsSchema = z.object({ id: z.string().min(1) })
const JobListQuerySchema = z.object({
  status: z.union([JobStatusSchema, z.array(JobStatusSchema)]).optional(),
  kind: z.enum(['rag.document.ingest', 'rag.strategy.build', 'rag.evaluation.run', 'agent.run', 'skill.run']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
})
const JobEventQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(5_000).default(1_000),
})

export const jobRoutes: FastifyPluginAsync<JobRoutesOptions> = async (app, options) => {
  const runtime = options.runtime

  app.post('/v1/jobs', async (request, reply) => {
    try {
      const input = CreateJobSchema.parse(request.body)
      const idempotencyKey = readHeader(request.headers['idempotency-key'])
      const job = runtime.createJob({ ...input, ...(idempotencyKey ? { idempotencyKey } : {}) })
      return reply.status(202).header('location', `/v1/jobs/${job.id}`).send({ data: job })
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.get('/v1/jobs', async (request, reply) => {
    try {
      const query = JobListQuerySchema.parse(request.query)
      return { data: runtime.listJobs(query) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.get('/v1/jobs/:id', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      const job = runtime.getJob(id)
      if (!job) return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} was not found` } })
      return { data: job }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.get('/v1/jobs/:id/artifacts', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      return { data: runtime.artifacts(id) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.get('/v1/jobs/:id/events', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      const query = JobEventQuerySchema.parse(request.query)
      const headerSeq = parseEventId(readHeader(request.headers['last-event-id']))
      const afterSeq = query.afterSeq ?? headerSeq ?? 0
      if (!acceptsEventStream(request.headers.accept)) return { data: runtime.events(id, afterSeq, query.limit) }
      return streamEvents(app, runtime, id, afterSeq, reply)
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.post('/v1/jobs/:id/cancel', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      return { data: runtime.cancel(id) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.post('/v1/jobs/:id/retry', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      return { data: runtime.retry(id) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.post('/v1/jobs/:id/recovery', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      return { data: runtime.resolveRecovery(id, JobRecoveryDecisionSchema.parse(request.body)) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })

  app.post('/v1/jobs/:id/input', async (request, reply) => {
    try {
      const { id } = JobIdParamsSchema.parse(request.params)
      return { data: runtime.provideInput(id, JsonValueSchema.parse(request.body)) }
    } catch (error) {
      return sendJobError(reply, error)
    }
  })
}

function streamEvents(app: FastifyInstance, runtime: TaskRuntime, jobId: string, afterSeq: number, reply: FastifyReply): void {
  if (!runtime.getJob(jobId)) throw Object.assign(new Error(`Job ${jobId} was not found`), { code: 'JOB_NOT_FOUND' })
  reply.hijack()
  const response = reply.raw
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders()
  let lastSeq = afterSeq
  let closed = false
  const write = (event: JobEvent) => {
    if (closed || event.seq <= lastSeq) return
    lastSeq = event.seq
    response.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  const unsubscribe = runtime.subscribe(jobId, write)
  for (const event of runtime.events(jobId, afterSeq)) write(event)
  const heartbeat = setInterval(() => {
    if (!closed) response.write(`: heartbeat ${new Date().toISOString()}\n\n`)
  }, 15_000)
  heartbeat.unref()
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
  }
  response.once('close', cleanup)
  response.once('error', (error: Error) => { app.log.debug({ error, jobId }, 'Job SSE connection closed'); cleanup() })
}

function acceptsEventStream(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value.join(',') : value ?? '').includes('text/event-stream')
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseEventId(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function sendJobError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown): unknown {
  const code = errorCode(error)
  const status = code === 'JOB_NOT_FOUND' ? 404 : code === 'IDEMPOTENCY_CONFLICT' || code === 'INVALID_JOB_TRANSITION' ? 409 : error instanceof z.ZodError ? 400 : 500
  return reply.status(status).send({ error: { code, message: error instanceof Error ? error.message : String(error) } })
}

function errorCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'INVALID_REQUEST'
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'INTERNAL_ERROR'
}
