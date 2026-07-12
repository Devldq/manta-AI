import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface DiagnosticEntry { id: string; timestamp: string; [key: string]: unknown }

const ownerContext = new AsyncLocalStorage<RuntimeDiagnosticsWriter>()
export const currentDiagnosticsOwner = () => ownerContext.getStore()
export const runWithDiagnosticsOwner = <T>(owner: RuntimeDiagnosticsWriter, operation: () => T): T => ownerContext.run(owner, operation)

export class RuntimeDiagnosticsWriter {
  private paused = false
  private buffered: DiagnosticEntry[] = []
  constructor(private root: string) {}

  append(entry: DiagnosticEntry): void {
    if (this.paused) { this.buffered.push(entry); return }
    this.appendNow(entry)
  }

  getLogFilePath(): string { return join(this.root, 'system.log') }
  getSessionLogFilePath(conversationId: string): string { return join(this.root, 'conversations', conversationId, 'log.ndjson') }

  quiesce(): void { this.paused = true }
  checkpoint(): void {}
  close(): void {}
  reopen(root: string): void { this.root = root; this.paused = false; this.flush() }
  dispose(): void { this.paused = false; this.flush() }

  private flush(): void {
    for (const entry of this.buffered.splice(0)) this.appendNow(entry)
  }

  private appendNow(entry: DiagnosticEntry): void {
    const target = join(this.root, 'system.log')
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8')
  }
}
