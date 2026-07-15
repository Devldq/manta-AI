import { FolderHealthPoller, SyncScheduler, type FolderHealth, type FolderHealthStatus, type SyncTrigger } from '@manta/storage-hub'

export interface CloudSyncVolume { volumeId: string; root: string }
export interface CloudSyncRuntimeOptions {
  volumes(): Promise<CloudSyncVolume[]>
  inspect(root: string): Promise<FolderHealth>
  sync(volumeId: string, trigger: SyncTrigger): Promise<void>
  pollIntervalMs: number
  syncIntervalMs: number
  onHealth?(volumeId: string, health: FolderHealth): void | Promise<void>
  onSyncError?(volumeId: string, trigger: SyncTrigger, error: unknown): void | Promise<void>
}

/**
 * Desktop-owned adapter joining read-only cloud health polling to all Git sync
 * triggers. A health result is captured before the initial sync; unknown state
 * deliberately blocks sync rather than risking an offline placeholder upload.
 */
export function createCloudSyncRuntime(options: CloudSyncRuntimeOptions) {
  let volumes: CloudSyncVolume[] = []
  const healthByVolume = new Map<string, FolderHealth>()
  const poller = new FolderHealthPoller({
    volumes: () => volumes,
    pollIntervalMs: options.pollIntervalMs,
    inspect: options.inspect,
    onHealth: async (volumeId, health) => {
      healthByVolume.set(volumeId, health)
      await options.onHealth?.(volumeId, health)
    },
  })
  let started = false
  let disposed = false
  const scheduler = new SyncScheduler({
    volumes: () => volumes.map((volume) => volume.volumeId),
    intervalMs: options.syncIntervalMs,
    health: async (volumeId): Promise<FolderHealthStatus> => healthByVolume.get(volumeId)?.status ?? 'unreadable',
    sync: options.sync,
    onError: options.onSyncError,
  })
  const refreshVolumes = async () => { volumes = await options.volumes() }
  return {
    async start() {
      if (started || disposed) return
      started = true
      await refreshVolumes()
      await poller.start()
      if (disposed) return
      await scheduler.start()
    },
    async syncNow(volumeId: string) {
      if (disposed) return
      await refreshVolumes()
      await poller.poll()
      await scheduler.schedule(volumeId, 'manual')
    },
    health(): Record<string, FolderHealth> { return Object.fromEntries(healthByVolume) },
    dispose() {
      disposed = true
      poller.dispose()
      scheduler.dispose()
    },
  }
}
