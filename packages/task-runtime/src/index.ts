import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CreateJobSchema,
  JobEventSchema,
  JobRecoveryDecisionSchema,
  JobSchema,
  type CreateJob,
  type Job,
  type JobArtifact,
  type JobEvent,
  type JobEventType,
  type JobKind,
  type JobRecoveryDecision,
  type JobStatus,
  type JsonValue,
} from '@manta/contracts'

export type ExecutorInterruptionPolicy = 'retry-safe' | 'manual-recovery'

export interface JobExecutorContext {
  readonly job: Job
  readonly attempt: number
  readonly signal: AbortSignal
  progress(value: number, data?: JsonValue): void
  checkpoint(name: string, data?: JsonValue): void
  readCheckpoint<T extends JsonValue = JsonValue>(name: string): T | undefined
  consumeInput<T extends JsonValue = JsonValue>(): T | undefined
  addArtifact(artifact: Omit<JobArtifact, 'id' | 'jobId' | 'createdAt'>): JobArtifact
  emit(type: JobEventType, data?: JsonValue): JobEvent
  waitForInput(request: JsonValue): never
  isCancellationRequested(): boolean
}

export interface JobExecutorRegistration {
  kind: JobKind
  interruption: ExecutorInterruptionPolicy
  execute(context: JobExecutorContext): Promise<JsonValue | void>
}

export interface TaskRuntimeOptions {
  databasePath: string
  workerId?: string
  concurrency?: number
  leaseMs?: number
  heartbeatMs?: number
  pollMs?: number
  now?: () => Date
}

export interface CreateJobOptions extends CreateJob {
  idempotencyKey?: string
}

export interface ListJobsOptions {
  status?: JobStatus | JobStatus[]
  kind?: JobKind
  limit?: number
  before?: string
}

export interface TaskRuntimeStopOptions {
  timeoutMs?: number
}

export class RetryableJobError extends Error {
  constructor(message: string, readonly retryAfterMs?: number, readonly details?: JsonValue) {
    super(message)
    this.name = 'RetryableJobError'
  }
}

export class RecoveryRequiredError extends Error {
  constructor(message: string, readonly details?: JsonValue) {
    super(message)
    this.name = 'RecoveryRequiredError'
  }
}

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease lost for job ${jobId}`)
    this.name = 'LeaseLostError'
  }
}

export class WaitingForInputError extends Error {
  readonly code = 'JOB_WAITING_FOR_INPUT'

  constructor(readonly request: JsonValue) {
    super('Job is waiting for input')
    this.name = 'WaitingForInputError'
  }
}

/**
 * AI/tool runtimes sometimes wrap an executor error in a `cause` chain before
 * returning it to the Job executor. Recover the original suspension signal so
 * a durable approval is never flattened into an ordinary tool failure.
 */
export function findWaitingForInputError(error: unknown): WaitingForInputError | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (current instanceof WaitingForInputError) return current
    if ('code' in current && current.code === 'JOB_WAITING_FOR_INPUT' && 'request' in current) {
      return new WaitingForInputError(current.request as JsonValue)
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

interface ActiveExecution {
  controller: AbortController
  leaseToken: string
  registration: JobExecutorRegistration
  promise: Promise<void>
}

interface JobRow {
  id: string
  kind: string
  status: string
  payload_json: string
  result_json: string | null
  error_json: string | null
  metadata_json: string
  attempt: number
  max_attempts: number
  event_seq: number
  progress: number | null
  checkpoint: string | null
  recovery_reason: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  available_at: string | null
  cancel_requested_at: string | null
  lease_owner: string | null
  lease_token: string | null
  lease_expires_at: string | null
}

interface EventRow {
  job_id: string
  seq: number
  type: string
  timestamp: string
  data_json: string
}

interface ArtifactRow {
  id: string
  job_id: string
  kind: string
  media_type: string
  name: string
  uri: string
  metadata_json: string
  created_at: string
}

const TERMINAL_STATUSES: JobStatus[] = ['cancelled', 'succeeded', 'failed']

export class TaskRuntime {
  readonly workerId: string
  private readonly db: Database.Database
  private readonly registrations = new Map<JobKind, JobExecutorRegistration>()
  private readonly listeners = new Map<string, Set<(event: JobEvent) => void>>()
  private readonly active = new Map<string, ActiveExecution>()
  private readonly concurrency: number
  private readonly leaseMs: number
  private readonly heartbeatMs: number
  private readonly pollMs: number
  private readonly now: () => Date
  private pollTimer?: NodeJS.Timeout
  private started = false
  private stopping = false
  private closed = false
  private pumping = false

  constructor(options: TaskRuntimeOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true })
    this.db = new Database(options.databasePath)
    this.workerId = options.workerId ?? `${process.pid}:${randomUUID()}`
    this.concurrency = Math.max(1, options.concurrency ?? 2)
    this.leaseMs = Math.max(1_000, options.leaseMs ?? 30_000)
    this.heartbeatMs = Math.max(250, Math.min(options.heartbeatMs ?? 10_000, this.leaseMs / 2))
    this.pollMs = Math.max(25, options.pollMs ?? 250)
    this.now = options.now ?? (() => new Date())
    this.configureDatabase()
    this.migrate()
  }

  register(registration: JobExecutorRegistration): this {
    if (this.started) throw new Error('Executors must be registered before TaskRuntime.start()')
    if (this.registrations.has(registration.kind)) throw new Error(`Executor already registered for ${registration.kind}`)
    this.registrations.set(registration.kind, registration)
    return this
  }

  hasExecutor(kind: JobKind): boolean { return this.registrations.has(kind) }

  start(): void {
    this.assertOpen()
    if (this.started) return
    this.started = true
    this.stopping = false
    this.recoverInterruptedJobs()
    this.pollTimer = setInterval(() => void this.pump(), this.pollMs)
    this.pollTimer.unref()
    void this.pump()
  }

  async stop(options: TaskRuntimeStopOptions = {}): Promise<void> {
    if (!this.started || this.stopping) return
    this.stopping = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    for (const execution of this.active.values()) execution.controller.abort(new Error('Manta service is stopping'))
    const executions = [...this.active.values()].map(({ promise }) => promise)
    if (executions.length) {
      const timeoutMs = Math.max(0, options.timeoutMs ?? 5_000)
      await Promise.race([
        Promise.allSettled(executions),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs)
          timer.unref()
        }),
      ])
    }
    this.interruptOwnedJobs()
    this.started = false
  }

  async close(options?: TaskRuntimeStopOptions): Promise<void> {
    if (this.closed) return
    await this.stop(options)
    this.closed = true
    this.db.close()
  }

  checkpoint(): void {
    this.assertOpen()
    this.db.pragma('wal_checkpoint(PASSIVE)')
  }

  integrityCheck(): { ok: boolean; error?: string } {
    this.assertOpen()
    const rows = this.db.pragma('quick_check') as Array<Record<string, string>>
    const results = rows.flatMap((row) => Object.values(row))
    return results.length === 1 && results[0] === 'ok'
      ? { ok: true }
      : { ok: false, error: results.join('; ') || 'SQLite quick_check returned no result' }
  }

  createJob(input: CreateJobOptions): Job {
    this.assertOpen()
    const parsed = CreateJobSchema.parse(input)
    const idempotencyKey = input.idempotencyKey?.trim()
    const fingerprint = requestFingerprint(parsed)
    const create = this.db.transaction(() => {
      if (idempotencyKey) {
        const existing = this.db.prepare('SELECT job_id, request_hash FROM idempotency_keys WHERE key = ?').get(idempotencyKey) as { job_id: string; request_hash: string } | undefined
        if (existing) {
          if (existing.request_hash !== fingerprint) throw codedError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with a different request')
          return this.requireJob(existing.job_id)
        }
      }
      const id = randomUUID()
      const now = this.timestamp()
      this.db.prepare(`INSERT INTO jobs (
        id, kind, status, payload_json, metadata_json, attempt, max_attempts, event_seq,
        created_at, updated_at, available_at
      ) VALUES (?, ?, 'queued', ?, ?, 0, ?, 0, ?, ?, ?)`).run(
        id,
        parsed.kind,
        JSON.stringify(parsed.payload),
        JSON.stringify(parsed.metadata),
        parsed.maxAttempts,
        now,
        now,
        now,
      )
      if (idempotencyKey) this.db.prepare('INSERT INTO idempotency_keys (key, job_id, request_hash, created_at) VALUES (?, ?, ?, ?)').run(idempotencyKey, id, fingerprint, now)
      this.appendEventInTransaction(id, 'job.created', { kind: parsed.kind })
      return this.requireJob(id)
    })
    const job = create()
    if (this.started) void this.pump()
    return job
  }

  getJob(id: string): Job | undefined {
    this.assertOpen()
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    return row ? mapJob(row) : undefined
  }

  listJobs(options: ListJobsOptions = {}): Job[] {
    this.assertOpen()
    const conditions: string[] = []
    const values: unknown[] = []
    if (options.kind) { conditions.push('kind = ?'); values.push(options.kind) }
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      if (statuses.length) {
        conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`)
        values.push(...statuses)
      }
    }
    if (options.before) { conditions.push('created_at < ?'); values.push(options.before) }
    values.push(Math.min(200, Math.max(1, options.limit ?? 50)))
    const rows = this.db.prepare(`SELECT * FROM jobs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values) as JobRow[]
    return rows.map(mapJob)
  }

  events(jobId: string, afterSeq = 0, limit = 1_000): JobEvent[] {
    this.assertOpen()
    this.requireJob(jobId)
    const rows = this.db.prepare('SELECT * FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(jobId, Math.max(0, afterSeq), Math.min(5_000, Math.max(1, limit))) as EventRow[]
    return rows.map(mapEvent)
  }

  artifacts(jobId: string): JobArtifact[] {
    this.assertOpen()
    this.requireJob(jobId)
    const rows = this.db.prepare('SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY created_at ASC, id ASC').all(jobId) as ArtifactRow[]
    return rows.map(mapArtifact)
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    this.assertOpen()
    this.requireJob(jobId)
    const listeners = this.listeners.get(jobId) ?? new Set()
    listeners.add(listener)
    this.listeners.set(jobId, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(jobId)
    }
  }

  /** Atomically presents persisted history before live events with one exclusive cursor. */
  subscribeFrom(jobId: string, afterSeq: number, listener: (event: JobEvent) => void): () => void {
    let cursor = Math.max(0, afterSeq)
    let replaying = true
    const pending: JobEvent[] = []
    const deliver = (event: JobEvent) => {
      if (event.seq <= cursor) return
      cursor = event.seq
      listener(event)
    }
    const unsubscribe = this.subscribe(jobId, event => {
      if (replaying) pending.push(event)
      else deliver(event)
    })

    let page: JobEvent[]
    do {
      page = this.events(jobId, cursor, 5_000)
      for (const event of page) deliver(event)
    } while (page.length === 5_000)

    replaying = false
    pending.sort((a, b) => a.seq - b.seq)
    for (const event of pending) deliver(event)
    return unsubscribe
  }

  cancel(jobId: string): Job {
    this.assertOpen()
    const cancel = this.db.transaction(() => {
      const job = this.requireJob(jobId)
      if (TERMINAL_STATUSES.includes(job.status)) return job
      const now = this.timestamp()
      if (['queued', 'retry_scheduled', 'recovery_required', 'waiting_for_input'].includes(job.status)) {
        this.db.prepare("UPDATE jobs SET status = 'cancelled', cancel_requested_at = ?, completed_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(now, now, now, jobId)
        this.appendEventInTransaction(jobId, 'job.cancellation_requested', {})
        this.appendEventInTransaction(jobId, 'job.cancelled', {})
      } else {
        this.db.prepare("UPDATE jobs SET status = 'cancelling', cancel_requested_at = ?, updated_at = ? WHERE id = ?").run(now, now, jobId)
        this.appendEventInTransaction(jobId, 'job.cancellation_requested', {})
      }
      return this.requireJob(jobId)
    })
    const job = cancel()
    this.active.get(jobId)?.controller.abort(new Error('Job cancellation requested'))
    return job
  }

  retry(jobId: string): Job {
    this.assertOpen()
    const retry = this.db.transaction(() => {
      const job = this.requireJob(jobId)
      if (!['failed', 'recovery_required', 'cancelled'].includes(job.status)) throw codedError('INVALID_JOB_TRANSITION', `Cannot retry job in ${job.status}`)
      const now = this.timestamp()
      this.db.prepare("UPDATE jobs SET status = 'queued', result_json = NULL, error_json = NULL, recovery_reason = NULL, completed_at = NULL, cancel_requested_at = NULL, available_at = ?, updated_at = ? WHERE id = ?").run(now, now, jobId)
      this.appendEventInTransaction(jobId, 'job.retry_scheduled', { manual: true })
      return this.requireJob(jobId)
    })
    const job = retry()
    if (this.started) void this.pump()
    return job
  }

  resolveRecovery(jobId: string, input: JobRecoveryDecision): Job {
    this.assertOpen()
    const decision = JobRecoveryDecisionSchema.parse(input)
    const resolve = this.db.transaction(() => {
      const job = this.requireJob(jobId)
      if (job.status !== 'recovery_required') throw codedError('INVALID_JOB_TRANSITION', `Job ${jobId} does not require recovery`)
      const now = this.timestamp()
      if (decision.decision === 'fail') {
        this.db.prepare("UPDATE jobs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ code: 'RECOVERY_REJECTED', message: decision.reason ?? 'Recovery was rejected' }), now, now, jobId)
        this.appendEventInTransaction(jobId, 'job.failed', { reason: decision.reason ?? null })
      } else {
        this.writeCheckpointInTransaction(jobId, '__recovery__', decision as unknown as JsonValue)
        this.db.prepare("UPDATE jobs SET status = 'queued', recovery_reason = NULL, available_at = ?, updated_at = ? WHERE id = ?").run(now, now, jobId)
        this.appendEventInTransaction(jobId, 'job.retry_scheduled', { recovery: decision.decision })
      }
      return this.requireJob(jobId)
    })
    const job = resolve()
    if (this.started) void this.pump()
    return job
  }

  provideInput(jobId: string, input: JsonValue): Job {
    this.assertOpen()
    const provide = this.db.transaction(() => {
      const job = this.requireJob(jobId)
      if (job.status !== 'waiting_for_input') throw codedError('INVALID_JOB_TRANSITION', `Job ${jobId} is not waiting for input`)
      const now = this.timestamp()
      this.writeCheckpointInTransaction(jobId, '__input__', input)
      this.db.prepare("UPDATE jobs SET status = 'queued', available_at = ?, updated_at = ? WHERE id = ?").run(now, now, jobId)
      this.appendEventInTransaction(jobId, 'job.input_received', {})
      return this.requireJob(jobId)
    })
    const job = provide()
    if (this.started) void this.pump()
    return job
  }

  private async pump(): Promise<void> {
    if (!this.started || this.stopping || this.pumping) return
    this.pumping = true
    try {
      while (!this.stopping && this.active.size < this.concurrency) {
        const claimed = this.claimNextJob()
        if (!claimed) break
        this.launch(claimed.job, claimed.registration, claimed.leaseToken)
      }
    } finally {
      this.pumping = false
    }
  }

  private claimNextJob(): { job: Job; registration: JobExecutorRegistration; leaseToken: string } | undefined {
    const now = this.timestamp()
    const rows = this.db.prepare("SELECT * FROM jobs WHERE status IN ('queued', 'retry_scheduled') AND (available_at IS NULL OR available_at <= ?) ORDER BY created_at ASC, id ASC LIMIT 25").all(now) as JobRow[]
    for (const row of rows) {
      const registration = this.registrations.get(row.kind as JobKind)
      if (!registration) continue
      const leaseToken = randomUUID()
      const leaseExpiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString()
      const claim = this.db.transaction(() => {
        const result = this.db.prepare("UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, ?), updated_at = ?, lease_owner = ?, lease_token = ?, lease_expires_at = ? WHERE id = ? AND status IN ('queued', 'retry_scheduled') AND (available_at IS NULL OR available_at <= ?)").run(now, now, this.workerId, leaseToken, leaseExpiresAt, row.id, now)
        if (result.changes !== 1) return undefined
        const job = this.requireJob(row.id)
        this.db.prepare('INSERT INTO job_attempts (job_id, attempt, worker_id, lease_token, started_at, status) VALUES (?, ?, ?, ?, ?, ?)').run(job.id, job.attempt, this.workerId, leaseToken, now, 'running')
        this.appendEventInTransaction(job.id, 'job.started', { attempt: job.attempt })
        return this.requireJob(job.id)
      })
      const job = claim()
      if (job) return { job, registration, leaseToken }
    }
    return undefined
  }

  private launch(job: Job, registration: JobExecutorRegistration, leaseToken: string): void {
    const controller = new AbortController()
    const promise = this.execute(job, registration, leaseToken, controller).finally(() => {
      this.active.delete(job.id)
      if (this.started && !this.stopping) void this.pump()
    })
    this.active.set(job.id, { controller, leaseToken, registration, promise })
    void promise.catch(() => undefined)
  }

  private async execute(job: Job, registration: JobExecutorRegistration, leaseToken: string, controller: AbortController): Promise<void> {
    const heartbeat = setInterval(() => {
      const expiresAt = new Date(this.now().getTime() + this.leaseMs).toISOString()
      const result = this.db.prepare("UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND lease_token = ? AND status IN ('running', 'cancelling')").run(expiresAt, this.timestamp(), job.id, this.workerId, leaseToken)
      if (result.changes !== 1) controller.abort(new LeaseLostError(job.id))
    }, this.heartbeatMs)
    heartbeat.unref()
    try {
      const result = await registration.execute(this.createContext(job, leaseToken, controller))
      this.finishSuccess(job.id, leaseToken, result ?? null)
    } catch (error) {
      this.finishError(job.id, leaseToken, registration, error)
    } finally {
      clearInterval(heartbeat)
    }
  }

  private createContext(job: Job, leaseToken: string, controller: AbortController): JobExecutorContext {
    const assertLease = () => {
      const row = this.db.prepare('SELECT status, lease_owner, lease_token FROM jobs WHERE id = ?').get(job.id) as { status: JobStatus; lease_owner: string | null; lease_token: string | null } | undefined
      if (!row || row.lease_owner !== this.workerId || row.lease_token !== leaseToken || !['running', 'cancelling'].includes(row.status)) throw new LeaseLostError(job.id)
    }
    return {
      job,
      attempt: job.attempt,
      signal: controller.signal,
      progress: (value, data = {}) => {
        assertLease()
        const progress = Math.min(1, Math.max(0, value))
        this.db.transaction(() => {
          this.db.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?').run(progress, this.timestamp(), job.id)
          this.appendEventInTransaction(job.id, 'job.progress', { progress, data })
        })()
      },
      checkpoint: (name, data = {}) => {
        assertLease()
        this.db.transaction(() => {
          this.writeCheckpointInTransaction(job.id, name, data)
          this.db.prepare('UPDATE jobs SET checkpoint = ?, updated_at = ? WHERE id = ?').run(name, this.timestamp(), job.id)
          this.appendEventInTransaction(job.id, 'job.checkpoint', { name, data })
        })()
      },
      readCheckpoint: <T extends JsonValue>(name: string) => this.readCheckpoint(job.id, name) as T | undefined,
      consumeInput: <T extends JsonValue>() => {
        const consume = this.db.transaction(() => {
          const value = this.readCheckpoint(job.id, '__input__') as T | undefined
          if (value !== undefined) this.db.prepare('DELETE FROM job_checkpoints WHERE job_id = ? AND name = ?').run(job.id, '__input__')
          return value
        })
        return consume()
      },
      addArtifact: (artifact) => {
        assertLease()
        const created: JobArtifact = { ...artifact, id: randomUUID(), jobId: job.id, createdAt: this.timestamp() }
        this.db.transaction(() => {
          this.db.prepare('INSERT INTO job_artifacts (id, job_id, kind, media_type, name, uri, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(created.id, created.jobId, created.kind, created.mediaType, created.name, created.uri, JSON.stringify(created.metadata), created.createdAt)
          this.appendEventInTransaction(job.id, 'artifact.created', { artifactId: created.id, kind: created.kind, name: created.name })
        })()
        return created
      },
      emit: (type, data = {}) => {
        assertLease()
        return this.db.transaction(() => this.appendEventInTransaction(job.id, type, data))()
      },
      waitForInput: (request) => { throw new WaitingForInputError(request) },
      isCancellationRequested: () => {
        const row = this.db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as { status: JobStatus } | undefined
        return row?.status === 'cancelling'
      },
    }
  }

  private finishSuccess(jobId: string, leaseToken: string, result: JsonValue): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT status FROM jobs WHERE id = ? AND lease_owner = ? AND lease_token = ?').get(jobId, this.workerId, leaseToken) as { status: JobStatus } | undefined
      if (!row) return
      const now = this.timestamp()
      const cancelled = row.status === 'cancelling'
      this.db.prepare('UPDATE jobs SET status = ?, result_json = ?, progress = ?, completed_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?').run(cancelled ? 'cancelled' : 'succeeded', JSON.stringify(result), cancelled ? null : 1, now, now, jobId)
      this.finishAttempt(jobId, cancelled ? 'cancelled' : 'succeeded', now)
      this.appendEventInTransaction(jobId, cancelled ? 'job.cancelled' : 'job.succeeded', cancelled ? {} : { result })
    })()
  }

  private finishError(jobId: string, leaseToken: string, registration: JobExecutorRegistration, error: unknown): void {
    this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM jobs WHERE id = ? AND lease_owner = ? AND lease_token = ?').get(jobId, this.workerId, leaseToken) as JobRow | undefined
      if (!job) return
      const now = this.timestamp()
      if (job.status === 'cancelling') {
        this.transitionTerminal(jobId, 'cancelled', now, undefined)
        this.appendEventInTransaction(jobId, 'job.cancelled', {})
        return
      }
      if (error instanceof WaitingForInputError) {
        this.db.prepare("UPDATE jobs SET status = 'waiting_for_input', updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(now, jobId)
        this.finishAttempt(jobId, 'waiting_for_input', now)
        this.appendEventInTransaction(jobId, 'job.waiting_for_input', { request: error.request })
        return
      }
      const message = errorMessage(error)
      if (error instanceof RecoveryRequiredError || (this.stopping && registration.interruption === 'manual-recovery')) {
        const reason = error instanceof RecoveryRequiredError ? error.message : 'Service stopped during a step whose side effects are uncertain'
        this.transitionRecoveryRequired(jobId, reason, now, error instanceof RecoveryRequiredError ? error.details : undefined)
        return
      }
      if (this.stopping || error instanceof LeaseLostError) {
        if (registration.interruption === 'retry-safe') this.transitionQueued(jobId, now, 'Executor interrupted and is safe to retry')
        else this.transitionRecoveryRequired(jobId, message, now)
        return
      }
      const retryable = error instanceof RetryableJobError
      if (retryable && job.attempt < job.max_attempts) {
        const delay = Math.max(0, error.retryAfterMs ?? retryDelay(job.attempt))
        const availableAt = new Date(this.now().getTime() + delay).toISOString()
        this.db.prepare("UPDATE jobs SET status = 'retry_scheduled', error_json = ?, available_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(JSON.stringify({ code: 'RETRYABLE_ERROR', message, details: error.details }), availableAt, now, jobId)
        this.finishAttempt(jobId, 'retry_scheduled', now, message)
        this.appendEventInTransaction(jobId, 'job.retry_scheduled', { attempt: job.attempt, availableAt, message })
        return
      }
      const code = retryable ? 'RETRIES_EXHAUSTED' : 'EXECUTOR_FAILED'
      this.transitionTerminal(jobId, 'failed', now, { code, message })
      this.appendEventInTransaction(jobId, 'job.failed', { code, message })
    })()
  }

  private recoverInterruptedJobs(): void {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE status IN ('running', 'cancelling')").all() as JobRow[]
    for (const row of rows) {
      this.db.transaction(() => {
        const current = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.id) as JobRow
        if (!['running', 'cancelling'].includes(current.status)) return
        const now = this.timestamp()
        if (current.status === 'cancelling') {
          this.transitionTerminal(current.id, 'cancelled', now, undefined)
          this.appendEventInTransaction(current.id, 'job.cancelled', { recovered: true })
          return
        }
        const registration = this.registrations.get(current.kind as JobKind)
        if (registration?.interruption === 'retry-safe') this.transitionQueued(current.id, now, 'Recovered after service restart')
        else this.transitionRecoveryRequired(current.id, 'Service restarted during a step whose side effects are uncertain', now)
      })()
    }
  }

  private interruptOwnedJobs(): void {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE lease_owner = ? AND status IN ('running', 'cancelling')").all(this.workerId) as JobRow[]
    for (const row of rows) {
      this.db.transaction(() => {
        const now = this.timestamp()
        if (row.status === 'cancelling') {
          this.transitionTerminal(row.id, 'cancelled', now, undefined)
          this.appendEventInTransaction(row.id, 'job.cancelled', { serviceStopped: true })
          return
        }
        const registration = this.registrations.get(row.kind as JobKind)
        if (registration?.interruption === 'retry-safe') this.transitionQueued(row.id, now, 'Service stopped before the executor acknowledged cancellation')
        else this.transitionRecoveryRequired(row.id, 'Service stopped during a step whose side effects are uncertain', now)
      })()
    }
  }

  private transitionQueued(jobId: string, now: string, reason: string): void {
    this.db.prepare("UPDATE jobs SET status = 'queued', available_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(now, now, jobId)
    this.finishAttempt(jobId, 'interrupted', now, reason)
    this.appendEventInTransaction(jobId, 'job.retry_scheduled', { interrupted: true, reason })
  }

  private transitionRecoveryRequired(jobId: string, reason: string, now: string, details?: JsonValue): void {
    this.db.prepare("UPDATE jobs SET status = 'recovery_required', recovery_reason = ?, error_json = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?").run(reason, JSON.stringify({ code: 'RECOVERY_REQUIRED', message: reason, details }), now, jobId)
    this.finishAttempt(jobId, 'recovery_required', now, reason)
    this.appendEventInTransaction(jobId, 'job.recovery_required', { reason, details: details ?? null })
  }

  private transitionTerminal(jobId: string, status: 'cancelled' | 'failed', now: string, error?: { code: string; message: string }): void {
    this.db.prepare('UPDATE jobs SET status = ?, error_json = ?, completed_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE id = ?').run(status, error ? JSON.stringify(error) : null, now, now, jobId)
    this.finishAttempt(jobId, status, now, error?.message)
  }

  private finishAttempt(jobId: string, status: string, now: string, error?: string): void {
    this.db.prepare("UPDATE job_attempts SET status = ?, completed_at = ?, error = ? WHERE job_id = ? AND attempt = (SELECT attempt FROM jobs WHERE id = ?) AND completed_at IS NULL").run(status, now, error ?? null, jobId, jobId)
  }

  private appendEventInTransaction(jobId: string, type: JobEventType, data: JsonValue): JobEvent {
    const now = this.timestamp()
    this.db.prepare('UPDATE jobs SET event_seq = event_seq + 1, updated_at = ? WHERE id = ?').run(now, jobId)
    const row = this.db.prepare('SELECT event_seq FROM jobs WHERE id = ?').get(jobId) as { event_seq: number } | undefined
    if (!row) throw codedError('JOB_NOT_FOUND', `Job ${jobId} was not found`)
    const event = JobEventSchema.parse({ jobId, seq: row.event_seq, type, timestamp: now, data })
    this.db.prepare('INSERT INTO job_events (job_id, seq, type, timestamp, data_json) VALUES (?, ?, ?, ?, ?)').run(jobId, event.seq, type, now, JSON.stringify(event.data))
    queueMicrotask(() => {
      for (const listener of this.listeners.get(jobId) ?? []) {
        try { listener(event) } catch { /* listeners cannot affect the worker */ }
      }
    })
    return event
  }

  private writeCheckpointInTransaction(jobId: string, name: string, data: JsonValue): void {
    this.db.prepare(`INSERT INTO job_checkpoints (job_id, name, data_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(job_id, name) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`).run(jobId, name, JSON.stringify(data), this.timestamp())
  }

  private readCheckpoint(jobId: string, name: string): JsonValue | undefined {
    const row = this.db.prepare('SELECT data_json FROM job_checkpoints WHERE job_id = ? AND name = ?').get(jobId, name) as { data_json: string } | undefined
    return row ? JSON.parse(row.data_json) as JsonValue : undefined
  }

  private requireJob(id: string): Job {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
    if (!row) throw codedError('JOB_NOT_FOUND', `Job ${id} was not found`)
    return mapJob(row)
  }

  private timestamp(): string { return this.now().toISOString() }

  private assertOpen(): void {
    if (this.closed) throw new Error('TaskRuntime is closed')
  }

  private configureDatabase(): void {
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('synchronous = NORMAL')
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        event_seq INTEGER NOT NULL DEFAULT 0,
        progress REAL,
        checkpoint TEXT,
        recovery_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        available_at TEXT,
        cancel_requested_at TEXT,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, available_at, created_at);
      CREATE INDEX IF NOT EXISTS jobs_kind_idx ON jobs(kind, created_at DESC);
      CREATE TABLE IF NOT EXISTS job_attempts (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        worker_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY(job_id, attempt)
      );
      CREATE TABLE IF NOT EXISTS job_events (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(job_id, seq)
      );
      CREATE TABLE IF NOT EXISTS job_checkpoints (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id, name)
      );
      CREATE TABLE IF NOT EXISTS job_artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        media_type TEXT NOT NULL,
        name TEXT NOT NULL,
        uri TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }
}

function mapJob(row: JobRow): Job {
  return JobSchema.parse(compactUndefined({
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    result: row.result_json === null ? undefined : JSON.parse(row.result_json),
    error: row.error_json === null ? undefined : JSON.parse(row.error_json),
    metadata: JSON.parse(row.metadata_json),
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    eventSeq: row.event_seq,
    progress: row.progress ?? undefined,
    checkpoint: row.checkpoint ?? undefined,
    recoveryReason: row.recovery_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    availableAt: row.available_at ?? undefined,
    cancelRequestedAt: row.cancel_requested_at ?? undefined,
  }))
}

function mapEvent(row: EventRow): JobEvent {
  return JobEventSchema.parse({ jobId: row.job_id, seq: row.seq, type: row.type, timestamp: row.timestamp, data: JSON.parse(row.data_json) })
}

function mapArtifact(row: ArtifactRow): JobArtifact {
  return {
    id: row.id,
    jobId: row.job_id,
    kind: row.kind,
    mediaType: row.media_type,
    name: row.name,
    uri: row.uri,
    metadata: JSON.parse(row.metadata_json) as Record<string, JsonValue>,
    createdAt: row.created_at,
  }
}

function compactUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function retryDelay(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requestFingerprint(input: CreateJob): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
