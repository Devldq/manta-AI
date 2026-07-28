declare module '@manta/backend' {
  import type { BootstrapStore } from '@manta/storage-hub'
  import type { TaskRuntime } from '@manta/task-runtime'

  export interface MantaServerHandle {
    readonly port: number
    readonly taskRuntime?: TaskRuntime
    quiesce(): Promise<void>
    close(): Promise<void>
    healthCheck(): Promise<{ ok: boolean; status: string; warnings: unknown[]; error?: string }>
  }

  export interface BackendStorageRuntime {
    resolve(group: import('@manta/shared').StorageGroupId, ...segments: string[]): string
    resolveLocalCache?(...segments: string[]): string
    recoverStartup(): Promise<void>
    quiesce(): Promise<void>
    checkpoint(): Promise<void>
    close(): Promise<void>
    healthCheck(): Promise<{ ok: boolean; status: string; warnings: unknown[]; error?: string }>
  }

  interface AgentReadModel {
    agents(): Promise<any>
    assets(adapterId: string, installationId: string): Promise<any>
    reuse(): Promise<any>
    operation(operationId: string): Promise<any>
  }

  export function createBackendStorageComposition(store: BootstrapStore, options?: { deferAgentRecovery?: boolean; localCacheRoot?: string }): Promise<{
    runtime: BackendStorageRuntime
    hub: { inventory(scope?: unknown): Promise<{ files: number; bytes: number; entries: unknown[] }>; capacityMetrics(): Promise<unknown> }
    git: { capability(): Promise<unknown>; listBindings(): Promise<unknown[]>; status(volumeId: string): Promise<string>; history(volumeId: string): Promise<string> }
    agents: { readModel: AgentReadModel }
    activateAgents(): Promise<{ readModel: AgentReadModel }>
  }>
  export function startServer(options: {
    storage: BackendStorageRuntime
    port?: number
    host?: string
    startSchedulers?: boolean
    startup?: false
    bundledSeedRoot?: string
    frontendDist?: string
    storageApi?: unknown
    apiOnly?: boolean
    isDev?: boolean
    logger?: boolean
    taskRuntimeDatabasePath?: string
    localAccess?: { tokens: Array<{ token: string; scopes: string[] }>; desktopNonces?: string[] }
  }): Promise<MantaServerHandle>
}
