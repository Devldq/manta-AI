import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { EmbeddingCacheManager, configureSQLiteVecProvider, resetSQLiteVecProvider } from '@manta/rag'
import { BootstrapStore, createStorageHub, GitBindingStore, GitRunner, GitSyncService, ImportCoordinator, volumeRoot, type StorageGroupDriver } from '@manta/storage-hub'
import { createClaudeInstallResource, createClaudeMarketplaceRuntimeOwner, type ClaudeMarketplaceRuntimeOwner, type PluginMarketplaceCache } from '../core/storage/plugin/marketplace'
import { createGroupDriver, createKnowledgeDriver, type ManagedGroupLifecycle } from './group-drivers'
import { runWithDiagnosticsOwner, RuntimeDiagnosticsWriter } from './runtime-diagnostics'
import { join } from 'node:path'
import { runWithStorageResolver } from './path-routing'
import { createProcessRegistry, type ProcessRegistry } from '../core/engine/runner/process-registry'
import { recoverExtensionTransactions } from './extension-transactions'
import { createCrossGroupBundleResources, migrateLegacyAtomicJournals, type LegacyRecoveryWarning } from './cross-group-bundle'
import { createRagUploadResources, recoverRagAssetTransactions } from './rag-upload-storage'
import { matchesReadyRagDocument } from './rag-asset-transactions'
import { createVolumePendingInspector } from './content-references'
import { createAgentStorageComposition } from './agent-storage'

export interface StorageResolver { resolve(group: StorageGroupId, ...segments: string[]): string }
export interface StorageHealthResult { ok: boolean; status: 'healthy' | 'degraded' | 'unhealthy'; warnings: LegacyRecoveryWarning[]; error?: string }
export interface BackendStorageRuntime extends StorageResolver {
  readonly drivers: Map<StorageGroupId, StorageGroupDriver>
  readonly diagnosticsWriter: RuntimeDiagnosticsWriter
  readonly marketplaceScheduler: ClaudeMarketplaceRuntimeOwner
  readonly processRegistry: ProcessRegistry
  readonly legacyRecoveryWarnings: LegacyRecoveryWarning[]
  recoverStartup(): Promise<void>
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
  let startupRecovery: Promise<void> | undefined
  const recoverStartup = () => startupRecovery ??= recoverRagAssetTransactions(
    { volumeRoot: join(storage.resolve('knowledge'), '..'), knowledgeRoot: storage.resolve('knowledge') },
    { isPipelineCommitted: async (record) => matchesReadyRagDocument(record, await provider.getDocument(record.documentId)) },
  )
  return {
    resolve: storage.resolve.bind(storage), drivers, diagnosticsWriter, marketplaceScheduler, processRegistry, legacyRecoveryWarnings,
    recoverStartup,
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
      try { await recoverStartup() } catch (error) { return { ok: false, status: 'unhealthy', warnings: legacyRecoveryWarnings, error: String(error) } }
      const health = await provider.integrityCheck(); if (!health.ok) return { ok: false, status: 'unhealthy', warnings: legacyRecoveryWarnings, error: health.error }
      return { ok: true, status: legacyRecoveryWarnings.length ? 'degraded' : 'healthy', warnings: legacyRecoveryWarnings }
    },
  }
}

export async function createBackendStorageComposition(bootstrap: BootstrapStore, options: { onProgress?: (progress: import('@manta/shared').StorageOperationProgress) => void; onAgentProgress?: (progress: import('./agent-storage').AgentStorageProgress) => void; deferAgentRecovery?: boolean } = {}) {
  const initialBootstrap = await bootstrap.read()
  if (initialBootstrap?.pendingMigration && !options.deferAgentRecovery) throw new Error('Storage migration recovery must complete before Agent storage recovery')
  let runtime: BackendStorageRuntime | undefined
  let git: GitSyncService | undefined
  const hub = await createStorageHub({
    bootstrap,
    onProgress: options.onProgress,
    capacityPending: async (volumeId, root) => {
      if (!runtime || !git) throw new Error('Capacity pending inspectors are not composed')
      const current = await bootstrap.read(); if (!current) throw new Error('Bootstrap does not exist')
      const groups = STORAGE_GROUP_IDS.filter((group) => current.groupAssignments[group] === volumeId)
      const migration = current.pendingMigration
      const migrationBlocks = !!migration && (migration.sourceVolumeId === volumeId || migration.targetVolumeId === volumeId || (!!migration.targetParentPath && volumeRoot(migration.targetParentPath) === root))
      const gitState = await git.inspectPending(volumeId)
      return createVolumePendingInspector({
        volumeRoot: root,
        knowledgeRoot: groups.includes('knowledge') ? runtime.resolve('knowledge') : join(root, 'knowledge'),
        extensionsRoot: groups.includes('extensions') ? runtime.resolve('extensions') : join(root, 'extensions'),
        groupRoots: groups.map((group) => runtime!.resolve(group)),
        migrationPending: () => migrationBlocks,
        gitPending: () => gitState,
      })()
    },
    createDrivers(storage) {
      runtime = createBackendStorageRuntime(storage)
      return runtime.drivers
    },
  })
  if (!runtime || !hub.migrations) throw new Error('Failed to compose Backend storage migration drivers')
  git = new GitSyncService({
    runner: new GitRunner(),
    // Resolve this lazily so config-group relocation is reflected after the required relaunch.
    bindings: new GitBindingStore(() => runtime!.resolve('config')),
    volumes: { resolveVolumeRoot: hub.resolveVolumeRoot },
    // Git checkouts are rebuildable workspaces, not part of a volume snapshot.
    // The cache group may live on a different volume and is routed lazily so its
    // own migration is reflected after relaunch.
    cachePath: (volumeId) => runtime!.resolve('cache', 'git-sync', volumeId),
    snapshots: {
      generation: () => initialBootstrap?.generation ?? 0,
      leases: hub.leases,
      checkpoint: async (group) => runtime!.drivers.get(group)?.checkpoint(),
    },
    // The importer delegates replacement to MigrationCoordinator so a remote
    // import has the same quiesce, validation, atomic swap, recovery, and
    // relaunch-safe lifecycle as every other live storage mutation.
    importer: new ImportCoordinator({
      resolveGroupRoot: (group) => runtime!.resolve(group),
      replaceGroups: async (groups, preflight) => { await hub.migrations!.replaceGroupsFromStaging(groups, undefined, preflight) },
    }),
  })
  let agents: Awaited<ReturnType<typeof createAgentStorageComposition>> | undefined
  const activateAgents = async () => agents ??= await createAgentStorageComposition({ resolve: (group, ...segments) => runtime!.resolve(group, ...segments), environment: { CODEX_HOME: process.env.CODEX_HOME }, onProgress: options.onAgentProgress })
  if (!options.deferAgentRecovery) await activateAgents()
  return { hub, runtime, git, activateAgents, get agents() { if (!agents) throw new Error('Agent storage composition has not been activated after storage recovery'); return agents } }
}
