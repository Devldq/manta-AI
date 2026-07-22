import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ManagedResource } from '../../../storage/group-drivers'

export interface ProcessRecord {
  taskId: string
  pid: number
  agentName: string
  startedAt: string
  jobId?: string
  attempt?: number
  processIdentity?: string
}

/** A work-group owned process registry. Construction is the only point where I/O starts. */
export class ProcessRegistry implements ManagedResource {
  private records: ProcessRecord[] = []
  private root: string
  private closed = false

  constructor(root: string) {
    this.root = root
    this.load()
    this.terminateRecordedProcesses()
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

  register(taskId: string, pid: number, agentName: string, metadata: { jobId?: string; attempt?: number } = {}): void {
    this.assertOpen()
    this.records.push({ taskId, pid, agentName, startedAt: new Date().toISOString(), ...metadata, processIdentity: processIdentity(pid) })
    this.persist()
  }

  async kill(taskId: string): Promise<{ killed: number; failed: number }> {
    this.assertOpen()
    const records = this.records.filter((record) => record.taskId === taskId)
    let killed = 0
    let failed = 0
    for (const record of records) {
      if (!this.isAlive(record.pid, record.processIdentity)) { killed += 1; continue }
      try {
        if (process.platform !== 'win32') process.kill(-record.pid, 'SIGTERM')
        else process.kill(record.pid, 'SIGTERM')
        killed += 1
      }
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

  cleanupProcess(taskId: string, pid: number): void {
    this.assertOpen()
    this.records = this.records.filter((record) => record.taskId !== taskId || record.pid !== pid)
    this.persist()
  }

  isAlive(pid: number, identity?: string): boolean {
    try {
      process.kill(pid, 0)
      return !identity || processIdentity(pid) === identity
    } catch { return false }
  }

  cleanupAll(): void {
    this.assertOpen()
    this.records = this.records.filter((record) => this.isAlive(record.pid, record.processIdentity))
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

  private terminateRecordedProcesses(): void {
    for (const record of this.records) {
      if (!this.isAlive(record.pid, record.processIdentity)) continue
      try {
        if (process.platform !== 'win32') process.kill(-record.pid, 'SIGTERM')
        else process.kill(record.pid, 'SIGTERM')
      } catch { /* best-effort orphan cleanup; identity was verified above */ }
    }
    if (this.records.length) {
      this.records = []
      this.persist()
    }
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

function processIdentity(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') {
      const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').trim().split(' ')
      return fields[21] ? `linux:${fields[21]}` : undefined
    }
    if (process.platform === 'darwin') {
      const started = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim()
      return started ? `darwin:${started}` : undefined
    }
  } catch { /* unavailable or already exited */ }
  return undefined
}
