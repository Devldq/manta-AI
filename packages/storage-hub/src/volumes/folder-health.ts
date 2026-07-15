import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type FolderHealthStatus = 'healthy' | 'offline' | 'unreadable' | 'conflict'
export type FolderHealthReason = 'root-unavailable' | 'inventory-unreadable'

export interface FolderHealth {
  root: string
  status: FolderHealthStatus
  conflicts: string[]
  checkedAt: string
  reason?: FolderHealthReason
}

export interface FolderHealthOptions {
  /** Injectable so platform integrations can use native cloud metadata APIs. */
  inventory?: (root: string) => Promise<{ entries: ReadonlyArray<{ relativePath: string }> }>
  now?: () => Date
}

export interface FolderHealthPollerOptions extends FolderHealthOptions {
  volumes: () => readonly { volumeId: string; root: string }[]
  pollIntervalMs: number
  onHealth?: (volumeId: string, health: FolderHealth) => void | Promise<void>
  onError?: (error: unknown) => void
  inspect?: (root: string) => Promise<FolderHealth>
}

const CONFLICT_COPY_NAME = /\bconflicted copy\b|\bconflict copy\b|\(conflict(?:ed)?(?:\s+copy)?[^)]*\)/i

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

function unreadable(error: unknown): boolean {
  return ['EACCES', 'EPERM', 'EIO', 'ENXIO', 'ENODATA', 'EBUSY'].includes(errorCode(error) ?? '')
}

/**
 * Enumerates names and file metadata only. In particular, this must not hash or
 * open files: doing either can ask a cloud provider to hydrate an offline file.
 */
async function metadataInventory(root: string): Promise<{ entries: Array<{ relativePath: string }> }> {
  const entries: Array<{ relativePath: string }> = []
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name)
      const relativePath = prefix ? `${prefix}/${name}` : name
      const stats = await lstat(absolute)
      entries.push({ relativePath })
      if (stats.isDirectory() && !stats.isSymbolicLink()) await walk(absolute, relativePath)
    }
  }
  await walk(root, '')
  return { entries }
}

/**
 * Reads only directory metadata. It intentionally never reads file contents,
 * hashes files, uses fs.watch, or changes the filesystem.
 */
export async function inspectFolderHealth(root: string, options: FolderHealthOptions = {}): Promise<FolderHealth> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  try {
    const inventory = await (options.inventory ?? metadataInventory)(root)
    const conflicts = inventory.entries
      .map((entry) => entry.relativePath)
      .filter((relativePath) => CONFLICT_COPY_NAME.test(relativePath))
      .sort()
    return { root, status: conflicts.length ? 'conflict' : 'healthy', conflicts, checkedAt }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { root, status: 'offline', reason: 'root-unavailable', conflicts: [], checkedAt }
    if (unreadable(error)) return { root, status: 'unreadable', reason: 'inventory-unreadable', conflicts: [], checkedAt }
    throw error
  }
}

/** Polling-only lifecycle owner for cloud-folder status. */
export class FolderHealthPoller {
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false
  private inFlight: Promise<void> | undefined

  constructor(private readonly options: FolderHealthPollerOptions) {}

  async start(): Promise<void> {
    if (this.disposed || this.timer) return
    await this.poll()
    if (this.disposed) return
    this.timer = setInterval(() => { void this.poll().catch((error) => this.options.onError?.(error)) }, this.options.pollIntervalMs)
  }

  async poll(): Promise<void> {
    if (this.disposed) return
    if (this.inFlight) return this.inFlight
    const run = (async () => {
      for (const volume of this.options.volumes()) {
        if (this.disposed) return
        const health = await (this.options.inspect ?? ((root: string) => inspectFolderHealth(root, this.options)))(volume.root)
        if (!this.disposed) await this.options.onHealth?.(volume.volumeId, health)
      }
    })()
    this.inFlight = run
    try { await run } finally { if (this.inFlight === run) this.inFlight = undefined }
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
