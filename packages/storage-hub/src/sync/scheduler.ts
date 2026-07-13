import type { FolderHealth, FolderHealthStatus } from '../volumes/folder-health'

export type SyncTrigger = 'manual' | 'startup' | 'interval'
type Health = FolderHealthStatus | Pick<FolderHealth, 'status'>

export interface SyncSchedulerOptions {
  volumes: () => readonly string[]
  intervalMs: number
  health: (volumeId: string) => Promise<Health>
  sync: (volumeId: string, trigger: SyncTrigger) => Promise<void>
  onSkip?: (volumeId: string, trigger: SyncTrigger, status: Exclude<FolderHealthStatus, 'healthy'>) => void | Promise<void>
  onError?: (volumeId: string, trigger: SyncTrigger, error: unknown) => void | Promise<void>
}

function statusOf(health: Health): FolderHealthStatus { return typeof health === 'string' ? health : health.status }

/**
 * Owns timer lifecycle and serializes every trigger for a volume. Queues are
 * independent, so a slow cloud folder never blocks a different volume.
 */
export class SyncScheduler {
  private readonly tails = new Map<string, Promise<void>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private startPromise: Promise<void> | undefined
  private disposed = false

  constructor(private readonly options: SyncSchedulerOptions) {}

  async start(): Promise<void> {
    if (this.disposed) return
    if (this.startPromise) return this.startPromise
    this.startPromise = (async () => {
      await Promise.all(this.options.volumes().map((volumeId) => this.schedule(volumeId, 'startup')))
      if (this.disposed) return
      this.timer = setInterval(() => {
        for (const volumeId of this.options.volumes()) void this.schedule(volumeId, 'interval').catch(() => {})
      }, this.options.intervalMs)
    })()
    return this.startPromise
  }

  schedule(volumeId: string, trigger: SyncTrigger): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const previous = this.tails.get(volumeId) ?? Promise.resolve()
    const scheduled = previous.catch(() => undefined).then(() => this.run(volumeId, trigger))
    this.tails.set(volumeId, scheduled)
    void scheduled.finally(() => { if (this.tails.get(volumeId) === scheduled) this.tails.delete(volumeId) }).catch(() => {})
    return scheduled
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async run(volumeId: string, trigger: SyncTrigger): Promise<void> {
    if (this.disposed) return
    try {
      const status = statusOf(await this.options.health(volumeId))
      if (this.disposed) return
      if (status !== 'healthy') { await this.options.onSkip?.(volumeId, trigger, status); return }
      await this.options.sync(volumeId, trigger)
    } catch (error) {
      // Timers have no caller to observe a rejection. Errors are routed to an
      // explicit sink instead of becoming process-level unhandled rejections.
      try { await this.options.onError?.(volumeId, trigger, error) } catch { /* reporting must not resurrect a rejected timer task */ }
      // A renderer-initiated action has a caller that must be able to show the
      // failure. Startup/interval work remains contained by this scheduler.
      if (trigger === 'manual') throw error
    }
  }
}
