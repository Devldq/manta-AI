import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ManagedResource } from '../../../storage/group-drivers'

export interface ProcessRecord {
  taskId: string
  pid: number
  agentName: string
  startedAt: string
}

/** A work-group owned process registry. Construction is the only point where I/O starts. */
export class ProcessRegistry implements ManagedResource {
  private records: ProcessRecord[] = []
  private root: string
  private closed = false

  constructor(root: string) {
    this.root = root
    this.load()
  }

  private get directory(): string { return join(this.root, 'processes') }
  private get file(): string { return join(this.directory, 'process-registry.json') }

  private load(): void {
    this.records = []
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      this.records = Array.isArray(parsed) ? parsed as ProcessRecord[] : []
    } catch {
      this.records = []
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('ProcessRegistry is closed')
  }

  register(taskId: string, pid: number, agentName: string): void {
    this.assertOpen()
    this.records.push({ taskId, pid, agentName, startedAt: new Date().toISOString() })
    this.persist()
  }

  async kill(taskId: string): Promise<{ killed: number; failed: number }> {
    this.assertOpen()
    const pids = this.records.filter((record) => record.taskId === taskId).map((record) => record.pid)
    let killed = 0
    let failed = 0
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); killed += 1 }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') killed += 1
        else failed += 1
      }
    }
    this.cleanup(taskId)
    return { killed, failed }
  }

  cleanup(taskId: string): void {
    this.assertOpen()
    this.records = this.records.filter((record) => record.taskId !== taskId)
    this.persist()
  }

  isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true } catch { return false }
  }

  cleanupAll(): void {
    this.assertOpen()
    this.records = this.records.filter((record) => this.isAlive(record.pid))
    this.persist()
  }

  getTaskProcesses(taskId: string): ProcessRecord[] {
    return this.records.filter((record) => record.taskId === taskId).map((record) => ({ ...record }))
  }

  getAllProcesses(): ProcessRecord[] { return this.records.map((record) => ({ ...record })) }

  private persist(): void {
    mkdirSync(this.directory, { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(this.records, null, 2), 'utf8')
    renameSync(temporary, this.file)
  }

  checkpoint(): void { if (!this.closed) this.persist() }
  close(): void { if (!this.closed) { this.persist(); this.closed = true } }
  integrityCheck(): { ok: boolean; error?: string } {
    if (!existsSync(this.file)) return { ok: true }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed) ? { ok: true } : { ok: false, error: 'Process registry must contain an array' }
    } catch (error) { return { ok: false, error: String(error) } }
  }
  reopen(root: string): void { this.root = root; this.closed = false; this.load() }
}

export function createProcessRegistry(workRoot: string): ProcessRegistry {
  return new ProcessRegistry(workRoot)
}
