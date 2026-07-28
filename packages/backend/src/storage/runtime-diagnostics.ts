import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface DiagnosticEntry { id: string; timestamp: string; [key: string]: unknown }

const SAFE_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

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
    if (this.paused) { this.buffered.push(entry); return true }
    return this.appendNow(entry)
  }

  /**
   * Queue best-effort diagnostics I/O outside the request/Agent event loop.
   * Slow or remote diagnostics volumes must never delay model streaming.
   */
  appendDeferred(entry: DiagnosticEntry): boolean {
    if (this.disposed || !this.accepting) return false
    if (this.paused) {
      this.buffered.push({ ...entry, __deferred: true })
      return true
    }
    this.queueDeferredWrite(entry)
    return true
  }

  appendAudit(entry: Record<string, unknown>): boolean {
    if (this.disposed || !this.accepting) return false
    const normalized: DiagnosticEntry = {
      id: typeof entry.id === 'string' ? entry.id : `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
      ...entry,
    }
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
