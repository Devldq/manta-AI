import {
  JobEventSchema,
  JobListSchema,
  JobSchema,
  RagSourceAssetSchema,
  RagUploadSessionSchema,
  type CreateRagUploadSession,
  type CreateJob,
  type Job,
  type JobEvent,
  type JobKind,
  type JobRecoveryDecision,
  type JobStatus,
  type JsonValue,
  type RagSourceAsset,
  type RagUploadSession,
} from '@manta/contracts'

export interface MantaClientOptions {
  baseURL: string
  apiKey?: string
  fetch?: typeof globalThis.fetch
  defaultHeaders?: Record<string, string>
}

export interface RequestOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  idempotencyKey?: string
}

export interface JobListOptions extends RequestOptions {
  status?: JobStatus | JobStatus[]
  kind?: JobKind
  limit?: number
  before?: string
}

export interface JobEventOptions extends RequestOptions {
  afterSeq?: number
  reconnectDelayMs?: number
}

export interface JobWaitOptions extends JobEventOptions {
  timeoutMs?: number
}

export interface UploadPartOptions extends RequestOptions {
  sha256?: string
}

export class MantaAPIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: JsonValue) {
    super(message)
    this.name = 'MantaAPIError'
  }
}

class APIResource {
  constructor(protected readonly client: Manta) {}
}

export class JobsResource extends APIResource {
  async create(input: CreateJob, options: RequestOptions = {}): Promise<Job> {
    const response = await this.client.request<{ data: unknown }>('/v1/jobs', {
      method: 'POST',
      body: input,
      ...options,
    })
    return JobSchema.parse(response.data)
  }

  async retrieve(id: string, options: RequestOptions = {}): Promise<Job> {
    const response = await this.client.request<{ data: unknown }>(`/v1/jobs/${encodeURIComponent(id)}`, options)
    return JobSchema.parse(response.data)
  }

  async list(options: JobListOptions = {}): Promise<{ data: Job[]; nextCursor?: string }> {
    const params = new URLSearchParams()
    if (options.status) for (const status of Array.isArray(options.status) ? options.status : [options.status]) params.append('status', status)
    if (options.kind) params.set('kind', options.kind)
    if (options.limit) params.set('limit', String(options.limit))
    if (options.before) params.set('before', options.before)
    const response = await this.client.request<unknown>(`/v1/jobs${params.size ? `?${params}` : ''}`, options)
    return JobListSchema.parse(response)
  }

  async history(id: string, options: JobEventOptions = {}): Promise<JobEvent[]> {
    const params = new URLSearchParams({ afterSeq: String(options.afterSeq ?? 0) })
    const response = await this.client.request<{ data: unknown[] }>(`/v1/jobs/${encodeURIComponent(id)}/events?${params}`, options)
    return response.data.map((event) => JobEventSchema.parse(event))
  }

  async artifacts(id: string, options: RequestOptions = {}) {
    return this.client.request<{ data: unknown[] }>(`/v1/jobs/${encodeURIComponent(id)}/artifacts`, options)
  }

  async *events(id: string, options: JobEventOptions = {}): AsyncGenerator<JobEvent> {
    let cursor = options.afterSeq ?? 0
    const reconnectDelayMs = Math.max(25, options.reconnectDelayMs ?? 250)
    while (true) {
      assertNotAborted(options.signal)
      const beforeConnect = await this.retrieve(id, { signal: options.signal })
      if (beforeConnect.eventSeq > cursor) {
        for (const event of await this.history(id, { afterSeq: cursor, signal: options.signal })) {
          if (event.seq <= cursor) continue
          cursor = event.seq
          yield event
          if (isStreamBoundaryEvent(event)) return
        }
      }
      if (isTerminal(beforeConnect.status) && cursor >= beforeConnect.eventSeq) return
      try {
        const response = await this.client.raw(`/v1/jobs/${encodeURIComponent(id)}/events?afterSeq=${cursor}`, {
          signal: options.signal,
          headers: { Accept: 'text/event-stream', ...(options.headers ?? {}) },
        })
        if (!response.ok) await this.client.throwResponseError(response)
        if (!response.body) throw new Error('Manta Service returned an empty event stream')
        for await (const event of parseEventStream(response.body, options.signal)) {
          if (event.seq <= cursor) continue
          cursor = event.seq
          yield event
          if (isStreamBoundaryEvent(event)) return
        }
      } catch (error) {
        if (options.signal?.aborted) throw abortReason(options.signal)
        if (error instanceof MantaAPIError && error.status === 404) throw error
      }
      const snapshot = await this.retrieve(id, { signal: options.signal })
      if (snapshot.eventSeq > cursor) {
        for (const event of await this.history(id, { afterSeq: cursor, signal: options.signal })) {
          if (event.seq <= cursor) continue
          cursor = event.seq
          yield event
        }
      }
      if (isTerminal(snapshot.status) && cursor >= snapshot.eventSeq) return
      await abortableDelay(reconnectDelayMs, options.signal)
    }
  }

  async wait(id: string, options: JobWaitOptions = {}): Promise<Job> {
    const timeout = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
    const signal = combineSignals(options.signal, timeout)
    let snapshot = await this.retrieve(id, { signal })
    if (isTerminal(snapshot.status) || snapshot.status === 'recovery_required' || snapshot.status === 'waiting_for_input') return snapshot
    for await (const _event of this.events(id, { ...options, afterSeq: options.afterSeq ?? snapshot.eventSeq, signal })) {
      snapshot = await this.retrieve(id, { signal })
      if (isTerminal(snapshot.status) || snapshot.status === 'recovery_required' || snapshot.status === 'waiting_for_input') return snapshot
    }
    return this.retrieve(id, { signal })
  }

  async cancel(id: string, options: RequestOptions = {}): Promise<Job> { return this.mutate(id, 'cancel', undefined, options) }
  async retry(id: string, options: RequestOptions = {}): Promise<Job> { return this.mutate(id, 'retry', undefined, options) }
  async resolveRecovery(id: string, decision: JobRecoveryDecision, options: RequestOptions = {}): Promise<Job> { return this.mutate(id, 'recovery', decision, options) }
  async provideInput(id: string, input: JsonValue, options: RequestOptions = {}): Promise<Job> { return this.mutate(id, 'input', input, options) }

  private async mutate(id: string, action: string, body: unknown, options: RequestOptions): Promise<Job> {
    const response = await this.client.request<{ data: unknown }>(`/v1/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(body === undefined ? {} : { body }), ...options })
    return JobSchema.parse(response.data)
  }
}

export class KnowledgeBasesResource extends APIResource {
  list(options?: RequestOptions) { return this.client.request('/v1/knowledge-bases', options) }
  create(input: JsonValue, options?: RequestOptions) { return this.client.request('/v1/knowledge-bases', { method: 'POST', body: input, ...options }) }
  retrieve(id: string, options?: RequestOptions) { return this.client.request(`/v1/knowledge-bases/${encodeURIComponent(id)}`, options) }
}

export class DocumentsResource extends APIResource {
  upload(knowledgeBaseId: string, body: BodyInit, options?: RequestOptions) { return this.client.request(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/uploads`, { method: 'POST', rawBody: body, ...options }) }
  async createUploadSession(knowledgeBaseId: string, input: CreateRagUploadSession, options?: RequestOptions): Promise<{ data: RagUploadSession }> {
    const response = await this.client.request<{ data: unknown }>(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/upload-sessions`, { method: 'POST', body: input, ...options })
    return { data: RagUploadSessionSchema.parse(response.data) }
  }
  async retrieveUploadSession(sessionId: string, options?: RequestOptions): Promise<{ data: RagUploadSession }> {
    const response = await this.client.request<{ data: unknown }>(`/v1/upload-sessions/${encodeURIComponent(sessionId)}`, options)
    return { data: RagUploadSessionSchema.parse(response.data) }
  }
  async uploadPart(sessionId: string, partNumber: number, body: BodyInit, options: UploadPartOptions = {}): Promise<{ data: RagUploadSession }> {
    const { sha256, headers, ...request } = options
    const response = await this.client.request<{ data: unknown }>(`/v1/upload-sessions/${encodeURIComponent(sessionId)}/parts/${partNumber}`, {
      method: 'PUT', rawBody: body, ...request,
      headers: { 'Content-Type': 'application/octet-stream', ...(sha256 ? { 'X-Part-Sha256': sha256 } : {}), ...(headers ?? {}) },
    })
    return { data: RagUploadSessionSchema.parse(response.data) }
  }
  async completeUploadSession(sessionId: string, options?: RequestOptions): Promise<{ data: { session: RagUploadSession; asset: RagSourceAsset } }> {
    const response = await this.client.request<{ data: { session: unknown; asset: unknown } }>(`/v1/upload-sessions/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', ...options })
    return { data: { session: RagUploadSessionSchema.parse(response.data.session), asset: RagSourceAssetSchema.parse(response.data.asset) } }
  }
  cancelUploadSession(sessionId: string, options?: RequestOptions) { return this.client.request(`/v1/upload-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', ...options }) }
  ingest(knowledgeBaseId: string, input: JsonValue, options?: RequestOptions) { return this.client.request(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`, { method: 'POST', body: input, ...options }) }
}

export class KnowledgeResource extends APIResource {
  search(input: JsonValue, options?: RequestOptions) { return this.client.request('/v1/knowledge/search', { method: 'POST', body: input, ...options }) }
}

export class StrategiesResource extends APIResource {
  list(knowledgeBaseId: string, options?: RequestOptions) { return this.client.request(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/strategies`, options) }
  create(knowledgeBaseId: string, input: JsonValue, options?: RequestOptions) { return this.client.request(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/strategies`, { method: 'POST', body: input, ...options }) }
  build(id: string, options?: RequestOptions) { return this.client.request(`/v1/strategies/${encodeURIComponent(id)}/build`, { method: 'POST', ...options }) }
  activate(id: string, options?: RequestOptions) { return this.client.request(`/v1/strategies/${encodeURIComponent(id)}/activate`, { method: 'POST', ...options }) }
}

export class EvaluationsResource extends APIResource {
  run(input: JsonValue, options?: RequestOptions) { return this.client.request('/v1/evaluations', { method: 'POST', body: input, ...options }) }
  list(datasetId?: string, options?: RequestOptions) { return this.client.request(`/v1/evaluation-runs${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ''}`, options) }
  retrieve(id: string, options?: RequestOptions) { return this.client.request(`/v1/evaluation-runs/${encodeURIComponent(id)}`, options) }
  compare(ids: string[], options?: RequestOptions) { return this.client.request(`/v1/evaluations/compare?ids=${encodeURIComponent(ids.join(','))}`, options) }
}

export class AgentsResource extends APIResource {
  run(input: JsonValue, options?: RequestOptions) { return this.client.request('/v1/agent-runs', { method: 'POST', body: input, ...options }) }
}

export class SkillsResource extends APIResource {
  list(options?: RequestOptions) { return this.client.request('/v1/skills', options) }
  retrieve(id: string, options?: RequestOptions) { return this.client.request(`/v1/skills/${encodeURIComponent(id)}`, options) }
  authorize(id: string, permissions: string[], options?: RequestOptions) { return this.client.request(`/v1/skills/${encodeURIComponent(id)}/authorization`, { method: 'POST', body: { permissions }, ...options }) }
  revokeAuthorization(id: string, options?: RequestOptions) { return this.client.request(`/v1/skills/${encodeURIComponent(id)}/authorization`, { method: 'DELETE', ...options }) }
  run(id: string, input: JsonValue, options?: RequestOptions) { return this.client.request(`/v1/skills/${encodeURIComponent(id)}/runs`, { method: 'POST', body: { input }, ...options }) }
}

type InternalRequestOptions = Omit<RequestInit, 'body' | 'headers' | 'signal'> & RequestOptions & {
  body?: unknown
  rawBody?: BodyInit
}

export class Manta {
  readonly jobs = new JobsResource(this)
  readonly knowledgeBases = new KnowledgeBasesResource(this)
  readonly documents = new DocumentsResource(this)
  readonly knowledge = new KnowledgeResource(this)
  readonly strategies = new StrategiesResource(this)
  readonly evaluations = new EvaluationsResource(this)
  readonly agents = new AgentsResource(this)
  readonly skills = new SkillsResource(this)
  readonly baseURL: string
  private readonly apiKey?: string
  private readonly fetcher: typeof globalThis.fetch
  private readonly defaultHeaders: Record<string, string>

  constructor(options: MantaClientOptions) {
    if (!options.baseURL) throw new Error('Manta baseURL is required')
    this.baseURL = options.baseURL.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.fetcher = options.fetch ?? globalThis.fetch
    if (!this.fetcher) throw new Error('A Fetch API implementation is required')
    this.defaultHeaders = options.defaultHeaders ?? {}
  }

  async request<T = unknown>(path: string, options: InternalRequestOptions = {}): Promise<T> {
    const response = await this.raw(path, options)
    if (!response.ok) await this.throwResponseError(response)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  async raw(path: string, options: InternalRequestOptions = {}): Promise<Response> {
    const { body, rawBody, idempotencyKey, headers, ...request } = options
    const resolvedHeaders: Record<string, string> = {
      ...this.defaultHeaders,
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(headers ?? {}),
    }
    return this.fetcher(`${this.baseURL}${path}`, { ...request, headers: resolvedHeaders, body: body === undefined ? rawBody : JSON.stringify(body) })
  }

  async throwResponseError(response: Response): Promise<never> {
    let payload: { error?: { code?: string; message?: string; details?: JsonValue } } = {}
    try { payload = await response.json() as typeof payload } catch { /* use HTTP status */ }
    throw new MantaAPIError(response.status, payload.error?.code ?? 'HTTP_ERROR', payload.error?.message ?? `Manta request failed with HTTP ${response.status}`, payload.error?.details)
  }
}

async function* parseEventStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<JobEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      assertNotAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) yield JobEventSchema.parse(JSON.parse(data))
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function isTerminal(status: JobStatus): boolean { return ['succeeded', 'failed', 'cancelled'].includes(status) }
function isStreamBoundaryEvent(event: JobEvent): boolean { return ['job.succeeded', 'job.failed', 'job.cancelled', 'job.recovery_required', 'job.waiting_for_input'].includes(event.type) }
function assertNotAborted(signal: AbortSignal | undefined): void { if (signal?.aborted) throw abortReason(signal) }
function abortReason(signal: AbortSignal): Error { return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError') }

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => { clearTimeout(timer); reject(abortReason(signal!)) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function combineSignals(left?: AbortSignal, right?: AbortSignal): AbortSignal | undefined {
  if (!left) return right
  if (!right) return left
  return AbortSignal.any([left, right])
}

export default Manta
