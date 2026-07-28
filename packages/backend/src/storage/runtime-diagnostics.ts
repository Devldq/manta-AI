import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface DiagnosticEntry { id: string; timestamp: string; [key: string]: unknown }

const SAFE_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_DIAGNOSTIC_STRING = 2_048
const MAX_DIAGNOSTIC_ARRAY = 50
const MAX_DIAGNOSTIC_KEYS = 80
const MAX_DIAGNOSTIC_DEPTH = 6
const MAX_DIAGNOSTIC_ENTRY_BYTES = 32 * 1_024
const REDACTED = '[REDACTED]'
const OMITTED_MODEL_OUTPUT = '[OMITTED: model output content]'
const TOKEN_COUNT_KEYS = new Set([
  'inputtokens',
  'outputtokens',
  'totaltokens',
  'cachereadtokens',
  'cachewritetokens',
  'nocachetokens',
  'maxoutputtokens',
  'promptcachehittokens',
])

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase()
  if (TOKEN_COUNT_KEYS.has(normalized)) return false
  return normalized === 'authorization'
    || normalized === 'apikey'
    || normalized === 'token'
    || normalized === 'accesstoken'
    || normalized === 'refreshtoken'
    || normalized === 'secret'
    || normalized === 'clientsecret'
    || normalized === 'password'
    || normalized === 'cookie'
    || normalized === 'credential'
    || normalized === 'prompt'
    || normalized === 'systemprompt'
    || normalized === 'systemcontent'
    || normalized === 'soulcontent'
    || normalized === 'messagespreview'
    || normalized === 'content'
    || normalized === 'text'
    || normalized === 'input'
    || normalized === 'output'
    || normalized === 'arguments'
    || normalized === 'result'
    || normalized === 'payload'
    || normalized === 'body'
    || normalized === 'raw'
    || normalized === 'email'
    || normalized === 'phone'
    || normalized === 'address'
}

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_ACCESS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
  const home = process.env.HOME
  if (home) sanitized = sanitized.split(home).join('~')
  return sanitized.length > MAX_DIAGNOSTIC_STRING
    ? `${sanitized.slice(0, MAX_DIAGNOSTIC_STRING)}…[truncated]`
    : sanitized
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return '[truncated: max depth]'
  if (Array.isArray(value)) {
    const entries = value.slice(0, MAX_DIAGNOSTIC_ARRAY).map((item) => sanitizeDiagnosticValue(item, depth + 1))
    if (value.length > MAX_DIAGNOSTIC_ARRAY) entries.push(`[truncated: ${value.length - MAX_DIAGNOSTIC_ARRAY} items]`)
    return entries
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, child] of entries.slice(0, MAX_DIAGNOSTIC_KEYS)) {
      output[key] = isSensitiveKey(key) ? REDACTED : sanitizeDiagnosticValue(child, depth + 1)
    }
    if (entries.length > MAX_DIAGNOSTIC_KEYS) output.__truncatedKeys = entries.length - MAX_DIAGNOSTIC_KEYS
    return output
  }
  return String(value)
}

/**
 * Diagnostics are viewable from the local UI and survive service restarts.
 * Sanitize before both in-memory collection and persistence so no API variant
 * can expose full prompts, credentials, or unbounded tool/model payloads.
 */
export function sanitizeDiagnosticEntry<T extends { id: string; timestamp: string }>(entry: T): T {
  const sanitized = sanitizeDiagnosticValue(entry) as DiagnosticEntry
  if (sanitized.type === 'model_output') {
    const details = sanitized.details && typeof sanitized.details === 'object'
      ? { ...(sanitized.details as Record<string, unknown>) }
      : {}
    const textLength = typeof details.textLength === 'number' ? details.textLength : undefined
    details.text = OMITTED_MODEL_OUTPUT
    sanitized.details = details
    sanitized.message = `Model output captured${textLength === undefined ? '' : ` (${textLength} chars)`}`
  }

  const serialized = JSON.stringify(sanitized)
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_DIAGNOSTIC_ENTRY_BYTES) return sanitized as unknown as T

  const metadata = sanitized.metadata && typeof sanitized.metadata === 'object'
    ? sanitized.metadata as Record<string, unknown>
    : undefined
  const compactMetadata = metadata ? {
    ...(typeof metadata.conversationId === 'string' ? { conversationId: metadata.conversationId } : {}),
    ...(typeof metadata.workspaceId === 'string' ? { workspaceId: metadata.workspaceId } : {}),
    ...(typeof metadata.messageId === 'string' ? { messageId: metadata.messageId } : {}),
    ...(typeof metadata.stepIndex === 'number' ? { stepIndex: metadata.stepIndex } : {}),
    ...(typeof metadata.durationMs === 'number' ? { durationMs: metadata.durationMs } : {}),
    ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
    ...(metadata.usage && typeof metadata.usage === 'object' ? { usage: metadata.usage } : {}),
  } : undefined
  const compact: DiagnosticEntry = {
    id: typeof sanitized.id === 'string' ? sanitized.id : entry.id,
    timestamp: typeof sanitized.timestamp === 'string' ? sanitized.timestamp : entry.timestamp,
    ...(typeof sanitized.level === 'string' ? { level: sanitized.level } : {}),
    ...(typeof sanitized.type === 'string' ? { type: sanitized.type } : {}),
    ...(typeof sanitized.source === 'string' ? { source: sanitized.source } : {}),
    message: sanitizeString(typeof sanitized.message === 'string' ? sanitized.message : 'Diagnostic entry'),
    details: {
      truncated: true,
      originalBytes: Buffer.byteLength(serialized, 'utf8'),
      limitBytes: MAX_DIAGNOSTIC_ENTRY_BYTES,
    },
    ...(compactMetadata ? { metadata: compactMetadata } : {}),
    ...(Array.isArray(sanitized.tags)
      ? { tags: sanitized.tags.slice(0, 10).map((tag) => sanitizeString(String(tag)).slice(0, 64)) }
      : {}),
  }
  return compact as unknown as T
}

function conversationIdOf(entry: DiagnosticEntry): string | undefined {
  const metadata = entry.metadata
  if (!metadata || typeof metadata !== 'object') return undefined
  const conversationId = (metadata as Record<string, unknown>).conversationId
  return typeof conversationId === 'string' && SAFE_CONVERSATION_ID.test(conversationId) && conversationId !== '.' && conversationId !== '..'
    ? conversationId
    : undefined
}

const ownerContext = new AsyncLocalStorage<RuntimeDiagnosticsWriter>()
export const currentDiagnosticsOwner = () => ownerContext.getStore()
export const runWithDiagnosticsOwner = <T>(owner: RuntimeDiagnosticsWriter, operation: () => T): T => ownerContext.run(owner, operation)
export const runWithoutDiagnosticsOwner = <T>(operation: () => T): T => ownerContext.exit(operation)

export class RuntimeDiagnosticsWriter {
  private paused = false
  private accepting = true
  private disposed = false
  private buffered: DiagnosticEntry[] = []
  private deferredWrites: Promise<void> = Promise.resolve()
  constructor(private root: string) {}

  append(entry: DiagnosticEntry): boolean {
    if (this.disposed || !this.accepting) return false
    const safeEntry = sanitizeDiagnosticEntry(entry)
    if (this.paused) { this.buffered.push(safeEntry); return true }
    return this.appendNow(safeEntry)
  }

  /**
   * Queue best-effort diagnostics I/O outside the request/Agent event loop.
   * Slow or remote diagnostics volumes must never delay model streaming.
   */
  appendDeferred(entry: DiagnosticEntry): boolean {
    if (this.disposed || !this.accepting) return false
    const safeEntry = sanitizeDiagnosticEntry(entry)
    if (this.paused) {
      this.buffered.push({ ...safeEntry, __deferred: true })
      return true
    }
    this.queueDeferredWrite(safeEntry)
    return true
  }

  appendAudit(entry: Record<string, unknown>): boolean {
    if (this.disposed || !this.accepting) return false
    const normalized = sanitizeDiagnosticEntry({
      id: typeof entry.id === 'string' ? entry.id : `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
      ...entry,
    } as DiagnosticEntry)
    if (this.paused) { this.buffered.push({ ...normalized, __audit: true }); return true }
    return this.appendAuditNow(normalized)
  }

  getLogFilePath(): string { return join(this.root, 'system.log') }
  getSessionLogFilePath(conversationId: string): string {
    return SAFE_CONVERSATION_ID.test(conversationId) && conversationId !== '.' && conversationId !== '..'
      ? join(this.root, 'conversations', conversationId, 'log.ndjson')
      : ''
  }
  readAuditEntries<T extends Record<string, unknown>>(): T[] {
    const target = join(this.root, 'audit.log')
    if (!existsSync(target)) return []
    return readFileSync(target, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as T] } catch { return [] }
    })
  }
  clearAudit(): void {
    if (!this.accepting || this.disposed) throw new Error('Diagnostics writer is not accepting mutations')
    const target = join(this.root, 'audit.log')
    if (existsSync(target)) unlinkSync(target)
  }
  auditSize(): number {
    const target = join(this.root, 'audit.log')
    return existsSync(target) ? statSync(target).size : 0
  }

  quiesce(): void { if (!this.disposed) this.paused = true }
  checkpoint(): Promise<void> { return this.deferredWrites }
  close(): void { if (!this.disposed) this.accepting = false }
  reopen(root: string): void {
    if (this.disposed) throw new Error('Diagnostics writer is disposed')
    this.root = root; this.accepting = true; this.paused = false; this.flush()
  }
  dispose(): void {
    if (this.disposed) return
    // Cross the terminal barrier before touching storage: failed best-effort I/O
    // must never make this owner writable or reopenable again.
    this.accepting = false; this.paused = false; this.disposed = true; this.flush()
  }

  private flush(): void {
    for (const entry of this.buffered.splice(0)) {
      if (entry.__audit === true) this.appendAuditNow(entry)
      else if (entry.__deferred === true) {
        const { __deferred: _, ...persisted } = entry
        this.queueDeferredWrite(persisted)
      }
      else this.appendNow(entry)
    }
  }

  private queueDeferredWrite(entry: DiagnosticEntry): void {
    const root = this.root
    this.deferredWrites = this.deferredWrites
      .then(async () => {
        const line = `${JSON.stringify(entry)}\n`
        const targets = [join(root, 'system.log')]
        const conversationId = conversationIdOf(entry)
        if (conversationId) targets.push(join(root, 'conversations', conversationId, 'log.ndjson'))
        for (const target of targets) {
          try {
            await mkdir(dirname(target), { recursive: true })
            await appendFile(target, line, 'utf8')
          } catch {
            // Diagnostics persistence is best effort and must not reject the
            // serialized queue or interfere with business requests.
          }
        }
      })
      .catch(() => {})
  }

  private appendAuditNow(entry: DiagnosticEntry): boolean {
    const { __audit: _, ...persisted } = entry
    try {
      const target = join(this.root, 'audit.log')
      mkdirSync(dirname(target), { recursive: true })
      appendFileSync(target, `${JSON.stringify(persisted)}\n`, 'utf8')
      return true
    } catch { return false }
  }

  private appendNow(entry: DiagnosticEntry): boolean {
    const line = `${JSON.stringify(entry)}\n`
    const targets = [join(this.root, 'system.log')]
    const conversationId = conversationIdOf(entry)
    if (conversationId) targets.push(join(this.root, 'conversations', conversationId, 'log.ndjson'))
    let ok = true
    for (const target of targets) {
      try {
        mkdirSync(dirname(target), { recursive: true })
        appendFileSync(target, line, 'utf8')
      } catch {
        // Diagnostics persistence is deliberately non-fatal. Do not log here:
        // the logger itself owns this writer and doing so would recurse.
        ok = false
      }
    }
    return ok
  }
}
