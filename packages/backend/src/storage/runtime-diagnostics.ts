import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface DiagnosticEntry { id: string; timestamp: string; [key: string]: unknown }

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
    this.appendNow(entry)
    return true
  }

  getLogFilePath(): string { return join(this.root, 'system.log') }
  getSessionLogFilePath(conversationId: string): string { return join(this.root, 'conversations', conversationId, 'log.ndjson') }

  quiesce(): void { if (!this.disposed) this.paused = true }
  checkpoint(): void { /* synchronous writes have no in-flight queue */ }
  close(): void { if (!this.disposed) this.accepting = false }
  reopen(root: string): void {
    if (this.disposed) throw new Error('Diagnostics writer is disposed')
    this.root = root; this.accepting = true; this.paused = false; this.flush()
  }
  dispose(): void {
    if (this.disposed) return
    this.accepting = false; this.paused = false; this.flush(); this.disposed = true
  }

  private flush(): void {
    for (const entry of this.buffered.splice(0)) this.appendNow(entry)
  }

  private appendNow(entry: DiagnosticEntry): void {
    const target = join(this.root, 'system.log')
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8')
  }
}
