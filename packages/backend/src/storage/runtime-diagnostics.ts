import { appendFileSync, mkdirSync } from 'node:fs'
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
  constructor(private root: string) {}

  append(entry: DiagnosticEntry): boolean {
    if (this.disposed || !this.accepting) return false
    if (this.paused) { this.buffered.push(entry); return true }
    return this.appendNow(entry)
  }

  getLogFilePath(): string { return join(this.root, 'system.log') }
  getSessionLogFilePath(conversationId: string): string {
    return SAFE_CONVERSATION_ID.test(conversationId) && conversationId !== '.' && conversationId !== '..'
      ? join(this.root, 'conversations', conversationId, 'log.ndjson')
      : ''
  }

  quiesce(): void { if (!this.disposed) this.paused = true }
  checkpoint(): void { /* synchronous writes have no in-flight queue */ }
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
    for (const entry of this.buffered.splice(0)) this.appendNow(entry)
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
