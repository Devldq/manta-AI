import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { EmbeddingCacheManager, configureSQLiteVecProvider, resetSQLiteVecProvider } from '@manta/rag'
import { BootstrapStore, createStorageHub, GitBindingStore, GitRunner, GitSyncService, type StorageGroupDriver } from '@manta/storage-hub'
import { createClaudeInstallResource, createClaudeMarketplaceRuntimeOwner, type ClaudeMarketplaceRuntimeOwner, type PluginMarketplaceCache } from '../core/storage/plugin/marketplace'
import { createGroupDriver, createKnowledgeDriver, type ManagedGroupLifecycle } from './group-drivers'
import { runWithDiagnosticsOwner, RuntimeDiagnosticsWriter } from './runtime-diagnostics'
import { join } from 'node:path'
import { runWithStorageResolver } from './path-routing'
import { createProcessRegistry, type ProcessRegistry } from '../core/engine/runner/process-registry'
import { recoverExtensionTransactions } from './extension-transactions'
import { createCrossGroupBundleResources, migrateLegacyAtomicJournals, type LegacyRecoveryWarning } from './cross-group-bundle'
import { createRagUploadResources } from './rag-upload-storage'

export interface StorageResolver { resolve(group: StorageGroupId, ...segments: string[]): string }
export interface StorageHealthResult { ok: boolean; status: 'healthy' | 'degraded' | 'unhealthy'; warnings: LegacyRecoveryWarning[]; error?: string }
export interface BackendStorageRuntime extends StorageResolver {
  readonly drivers: Map<StorageGroupId, StorageGroupDriver>
  readonly diagnosticsWriter: RuntimeDiagnosticsWriter
  readonly marketplaceScheduler: ClaudeMarketplaceRuntimeOwner
  readonly processRegistry: ProcessRegistry
  readonly legacyRecoveryWarnings: LegacyRecoveryWarning[]
  runInStorageContext<T>(operation: () => T): T
  quiesce(): Promise<void>
  checkpoint(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<StorageHealthResult>
}

export interface BackendRuntimeOptions {
  groupLifecycles?: Partial<Record<StorageGroupId, ManagedGroupLifecycle>>
  marketplaceRefresh?: (dataDir: string) => Promise<PluginMarketplaceCache>
}

export function createBackendStorageRuntime(storage: StorageResolver, options: BackendRuntimeOptions = {}): BackendStorageRuntime {
  recoverExtensionTransactions(storage.resolve('extensions'))
  const legacyRecoveryWarnings = migrateLegacyAtomicJournals(join(storage.resolve('secrets'), '.transactions'), STORAGE_GROUP_IDS.map((id) => storage.resolve(id)), storage.resolve('diagnostics', 'legacy-recovery'))
  const provider = configureSQLiteVecProvider(storage.resolve('knowledge', 'rag'))
  const cache = new EmbeddingCacheManager(storage.resolve('knowledge', 'rag', 'cache'))
  const diagnosticsWriter = new RuntimeDiagnosticsWriter(storage.resolve('diagnostics'))
  const marketplaceScheduler = createClaudeMarketplaceRuntimeOwner(
    storage.resolve('extensions', 'plugin-marketplace'),
    options.marketplaceRefresh,
    (operation) => runWithDiagnosticsOwner(diagnosticsWriter, operation),
  )
  const processRegistry = createProcessRegistry(storage.resolve('work'))
  const claudeInstallResource = createClaudeInstallResource(storage.resolve('extensions'))
  const configSecretResources = createCrossGroupBundleResources([{ name: 'metadata', root: storage.resolve('config') }, { name: 'secret', root: storage.resolve('secrets') }])
  const knowledgeSecretResources = createCrossGroupBundleResources([{ name: 'metadata', root: storage.resolve('knowledge') }, { name: 'secret', root: storage.resolve('secrets') }])
  const ragUploadResources = createRagUploadResources(storage.resolve('cache', 'uploads'), storage.resolve('knowledge'), (hash) => provider.hasSourceSha256(hash))
  const lifecycles = new Map<StorageGroupId, ManagedGroupLifecycle>()
  let resumeMarketplace: (() => void) | undefined
  const extensionLifecycle = options.groupLifecycles?.extensions ?? {
    quiesce() { resumeMarketplace ??= marketplaceScheduler.pause() },
    checkpoint: () => marketplaceScheduler.checkpoint(),
    close() {},
    async reopen(root) { recoverExtensionTransactions(root); await marketplaceScheduler.reopen(join(root, 'plugin-marketplace')); resumeMarketplace?.(); resumeMarketplace = undefined },
    async dispose() { resumeMarketplace?.(); resumeMarketplace = undefined; await marketplaceScheduler.dispose() },
  }
  const diagnosticsLifecycle = options.groupLifecycles?.diagnostics ?? {
    quiesce: () => diagnosticsWriter.quiesce(), checkpoint: () => diagnosticsWriter.checkpoint(), close: () => diagnosticsWriter.close(),
    reopen: (root) => diagnosticsWriter.reopen(root), dispose: () => diagnosticsWriter.dispose(),
  }
  lifecycles.set('extensions', extensionLifecycle)
  lifecycles.set('diagnostics', diagnosticsLifecycle)
  const drivers = new Map<StorageGroupId, StorageGroupDriver>()
  for (const id of STORAGE_GROUP_IDS) {
    drivers.set(id, id === 'knowledge'
      ? createKnowledgeDriver(provider, cache, undefined, [knowledgeSecretResources.metadata, ragUploadResources.knowledge])
      : createGroupDriver(id, id === 'work' ? [processRegistry]
        : id === 'extensions' ? [claudeInstallResource]
        : id === 'config' ? [configSecretResources.metadata]
          : id === 'secrets' ? [configSecretResources.secret, knowledgeSecretResources.secret]
            : id === 'cache' ? [ragUploadResources.cache] : [], lifecycles.get(id)))
  }
  let quiesced = false
  let closed = false
  return {
    resolve: storage.resolve.bind(storage), drivers, diagnosticsWriter, marketplaceScheduler, processRegistry, legacyRecoveryWarnings,
    runInStorageContext: (operation) => runWithStorageResolver(storage, () => runWithDiagnosticsOwner(diagnosticsWriter, operation)),
    async quiesce() {
      quiesced = true
      const results = await Promise.allSettled([...drivers.values()].map((driver) => driver.quiesce()))
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Backend storage quiesce failed')
    },
    async checkpoint() {
      const results = await Promise.allSettled([...drivers.values()].map((driver) => driver.checkpoint()))
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Backend storage checkpoint failed')
    },
    async close() {
      if (closed) return
      closed = true
      const results = await Promise.allSettled([
        ...[...drivers.values()].map((driver) => driver.close()),
        ...[...lifecycles.values()].map((lifecycle) => lifecycle.dispose()),
      ])
      let resetError: unknown
      try { await resetSQLiteVecProvider() } catch (error) { resetError = error }
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason)
      if (resetError) errors.push(resetError)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Backend storage shutdown failed')
    },
    async healthCheck() {
      if (closed) return { ok: false, status: 'unhealthy', warnings: [], error: 'closed' }
      if (quiesced) return { ok: false, status: 'unhealthy', warnings: [], error: 'quiesced' }
      const health = await provider.integrityCheck(); if (!health.ok) return { ok: false, status: 'unhealthy', warnings: legacyRecoveryWarnings, error: health.error }
      return { ok: true, status: legacyRecoveryWarnings.length ? 'degraded' : 'healthy', warnings: legacyRecoveryWarnings }
    },
  }
}

export async function createBackendStorageComposition(bootstrap: BootstrapStore, options: { onProgress?: (progress: import('@manta/shared').StorageOperationProgress) => void } = {}) {
  const initialBootstrap = await bootstrap.read()
  let runtime: BackendStorageRuntime | undefined
  const hub = await createStorageHub({
    bootstrap,
    onProgress: options.onProgress,
    createDrivers(storage) {
      runtime = createBackendStorageRuntime(storage)
      return runtime.drivers
    },
  })
  if (!runtime || !hub.migrations) throw new Error('Failed to compose Backend storage migration drivers')
  const git = new GitSyncService({
    runner: new GitRunner(),
    // Resolve this lazily so config-group relocation is reflected after the required relaunch.
    bindings: new GitBindingStore(() => runtime!.resolve('config')),
    volumes: { resolveVolumeRoot: hub.resolveVolumeRoot },
    snapshots: {
      generation: () => initialBootstrap?.generation ?? 0,
      leases: hub.leases,
      checkpoint: async (group) => runtime!.drivers.get(group)?.checkpoint(),
    },
  })
  return { hub, runtime, git }
}
