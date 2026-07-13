import { inventoryTree, type StorageInventory } from '../inventory/file-inventory'

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
  /** Injectable so platform integrations can use metadata-only cloud inventory APIs. */
  inventory?: (root: string) => Promise<Pick<StorageInventory, 'entries'>>
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
 * Reads only a volume inventory. It intentionally never uses fs.watch or changes
 * the filesystem, so a cloud provider's offline placeholder can never become an
 * empty local snapshot.
 */
export async function inspectFolderHealth(root: string, options: FolderHealthOptions = {}): Promise<FolderHealth> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString()
  try {
    const inventory = await (options.inventory ?? inventoryTree)(root)
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
