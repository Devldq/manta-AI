import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { EmbeddingCacheManager, configureSQLiteVecProvider, resetSQLiteVecProvider } from '@manta/rag'
import { BootstrapStore, createStorageHub, type StorageGroupDriver } from '@manta/storage-hub'
import { createClaudeMarketplaceRuntimeOwner, type ClaudeMarketplaceRuntimeOwner, type PluginMarketplaceCache } from '../core/storage/plugin/marketplace'
import { createGroupDriver, createKnowledgeDriver, type ManagedGroupLifecycle } from './group-drivers'
import { runWithDiagnosticsOwner, RuntimeDiagnosticsWriter } from './runtime-diagnostics'
import { join } from 'node:path'
import { runWithStorageResolver } from './path-routing'
import { createProcessRegistry, type ProcessRegistry } from '../core/engine/runner/process-registry'
import { recoverExtensionTransactions } from './extension-transactions'
import { createAtomicBundleResource } from './atomic-record-bundle'
import { createRagUploadResource } from './rag-upload-storage'

export interface StorageResolver { resolve(group: StorageGroupId, ...segments: string[]): string }
export interface BackendStorageRuntime extends StorageResolver {
  readonly drivers: Map<StorageGroupId, StorageGroupDriver>
  readonly diagnosticsWriter: RuntimeDiagnosticsWriter
  readonly marketplaceScheduler: ClaudeMarketplaceRuntimeOwner
  readonly processRegistry: ProcessRegistry
  runInStorageContext<T>(operation: () => T): T
  quiesce(): Promise<void>
  checkpoint(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
}

export interface BackendRuntimeOptions {
  groupLifecycles?: Partial<Record<StorageGroupId, ManagedGroupLifecycle>>
  marketplaceRefresh?: (dataDir: string) => Promise<PluginMarketplaceCache>
}

export function createBackendStorageRuntime(storage: StorageResolver, options: BackendRuntimeOptions = {}): BackendStorageRuntime {
  recoverExtensionTransactions(storage.resolve('extensions'))
  const provider = configureSQLiteVecProvider(storage.resolve('knowledge', 'rag'))
  const cache = new EmbeddingCacheManager(storage.resolve('knowledge', 'rag', 'cache'))
  const diagnosticsWriter = new RuntimeDiagnosticsWriter(storage.resolve('diagnostics'))
  const marketplaceScheduler = createClaudeMarketplaceRuntimeOwner(
    storage.resolve('extensions', 'plugin-marketplace'),
    options.marketplaceRefresh,
    (operation) => runWithDiagnosticsOwner(diagnosticsWriter, operation),
  )
  const processRegistry = createProcessRegistry(storage.resolve('work'))
  const bundleResources = { config: createAtomicBundleResource(storage.resolve('config')), secrets: createAtomicBundleResource(storage.resolve('secrets')) }
  const ragUploadResource = createRagUploadResource(storage.resolve('cache', 'uploads'))
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
      ? createKnowledgeDriver(provider, cache)
      : createGroupDriver(id, id === 'work' ? [processRegistry] : id === 'config' || id === 'secrets' ? [bundleResources[id]] : id === 'cache' ? [ragUploadResource] : [], lifecycles.get(id)))
  }
  let quiesced = false
  let closed = false
  return {
    resolve: storage.resolve.bind(storage), drivers, diagnosticsWriter, marketplaceScheduler, processRegistry,
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
      if (closed) return { ok: false, error: 'closed' }
      if (quiesced) return { ok: false, error: 'quiesced' }
      return provider.integrityCheck()
    },
  }
}

export async function createBackendStorageComposition(bootstrap: BootstrapStore) {
  let runtime: BackendStorageRuntime | undefined
  const hub = await createStorageHub({
    bootstrap,
    createDrivers(storage) {
      runtime = createBackendStorageRuntime(storage)
      return runtime.drivers
    },
  })
  if (!runtime || !hub.migrations) throw new Error('Failed to compose Backend storage migration drivers')
  return { hub, runtime }
}
