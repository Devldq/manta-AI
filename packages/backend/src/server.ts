import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildApp, type BuildAppOptions } from './app'
import type { BackendStorageRuntime, StorageHealthResult } from './storage/runtime'
import { acquireClaudeMarketplaceScheduler } from './core/storage/plugin/marketplace'
import { acquireLogScheduler } from './core/observability/log/index'
import type { FastifyInstance } from 'fastify'
import type { StorageApiContext } from './routes/storage'
import { TaskRuntime } from '@manta/task-runtime'
import type { LocalAccessOptions } from './local-access'
import { createQdrantProvider, type QdrantProvider } from '@manta/rag/qdrant'

export { buildApp } from './app'

export { createBackendStorageComposition } from './storage/runtime'

export interface ServerStartupHooks {
  cleanupStaleRag(): void | Promise<void>
  initializeSkills(): void | Promise<void>
}

export type ManagedBackendStorage = Omit<BackendStorageRuntime, 'drivers' | 'diagnosticsWriter' | 'marketplaceScheduler' | 'processRegistry' | 'ragProvider' | 'runInStorageContext' | 'legacyRecoveryWarnings' | 'recoverStartup'> &
  Partial<Pick<BackendStorageRuntime, 'diagnosticsWriter' | 'marketplaceScheduler' | 'processRegistry' | 'ragProvider' | 'runInStorageContext' | 'recoverStartup'>>

export interface StartServerOptions {
  storage: ManagedBackendStorage
  port?: number
  host?: string
  startSchedulers?: boolean
  registerRoutes?: boolean
  startup?: false | ServerStartupHooks
  appFactory?: (options: BuildAppOptions) => Promise<FastifyInstance>
  schedulerAcquirers?: Array<(log: FastifyInstance['log']) => () => void | Promise<void>>
  bundledSeedRoot?: string
  storageApi?: StorageApiContext
  frontendDist?: string
  isDev?: boolean
  logger?: boolean
  taskRuntime?: TaskRuntime
  configureTaskRuntime?: (runtime: TaskRuntime) => void | Promise<void>
  apiOnly?: boolean
  localAccess?: LocalAccessOptions
}

export interface MantaServerHandle {
  readonly port: number
  readonly taskRuntime?: TaskRuntime
  quiesce(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<StorageHealthResult>
}

export async function initializeBundledExtensionsForStartup<T>(options: {
  seed(): Promise<void>
  loadRuntime(): Promise<{ scanPlugins(): T[]; registerPlugin(scanned: T): void; initializeSkills(): unknown | Promise<unknown> }>
}): Promise<void> {
  await options.seed()
  const runtime = await options.loadRuntime()
  for (const scanned of runtime.scanPlugins()) runtime.registerPlugin(scanned)
  await runtime.initializeSkills()
}

export async function startServer(options: StartServerOptions): Promise<MantaServerHandle> {
  let app: FastifyInstance | undefined
  let taskRuntime: TaskRuntime | undefined
  let ownedRagProvider: QdrantProvider | undefined
  const ragProvider = () => options.storage.ragProvider ?? (ownedRagProvider ??= createQdrantProvider())
  const schedulerDisposers: Array<() => void | Promise<void>> = []
  const startup = options.startup === false ? undefined : options.startup ?? defaultStartupHooks(options.bundledSeedRoot, () => options.storage.ragProvider ?? ownedRagProvider)
  const runInStorageContext = <T>(operation: () => T): T => options.storage.runInStorageContext
    ? options.storage.runInStorageContext(operation)
    : operation()
  let localEndpoint: string | undefined
  try {
    await runInStorageContext(() => options.storage.recoverStartup?.())
    taskRuntime = options.taskRuntime ?? (options.registerRoutes === false ? undefined : new TaskRuntime({ databasePath: options.storage.resolve('work', 'jobs', 'jobs.sqlite') }))
    if (taskRuntime) {
      await options.configureTaskRuntime?.(taskRuntime)
      if (!taskRuntime.hasExecutor('rag.document.ingest')) {
        const { createRagIngestExecutor } = await import('./core/engine/rag/ingest-executor.js')
        const executor = createRagIngestExecutor({ knowledge: options.storage.resolve('knowledge'), cache: options.storage.resolve('cache'), provider: ragProvider() })
        taskRuntime.register({ ...executor, execute: (context) => runInStorageContext(() => executor.execute(context)) })
      }
      if (!taskRuntime.hasExecutor('rag.strategy.build') || !taskRuntime.hasExecutor('rag.evaluation.run')) {
        const { createStrategyBuildExecutor, createEvaluationExecutor } = await import('./core/engine/rag/retrieval-lab-executors.js')
        const roots = { knowledge: options.storage.resolve('knowledge') }
        for (const executor of [createStrategyBuildExecutor(roots), createEvaluationExecutor(roots)]) {
          if (!taskRuntime.hasExecutor(executor.kind)) taskRuntime.register({ ...executor, execute: (context) => runInStorageContext(() => executor.execute(context)) })
        }
      }
      if (!taskRuntime.hasExecutor('agent.run')) {
        const { createAgentRunExecutor } = await import('./core/engine/durable-agent-executor.js')
        const executor = createAgentRunExecutor({ processRegistry: options.storage.processRegistry })
        taskRuntime.register({ ...executor, execute: (context) => runInStorageContext(() => executor.execute(context)) })
      }
      if (!taskRuntime.hasExecutor('skill.run')) {
        const { createSkillRunExecutor } = await import('./core/engine/durable-skill-executor.js')
        const executor = createSkillRunExecutor({
          extensionsRoot: options.storage.resolve('extensions'),
          grantsPath: options.storage.resolve('extensions', 'skill-grants.json'),
          tokens: options.localAccess?.tokens,
          endpoint: () => localEndpoint,
        })
        taskRuntime.register({ ...executor, execute: (context) => runInStorageContext(() => executor.execute(context)) })
      }
    }
    app = await runInStorageContext(() => (options.appFactory ?? buildApp)({ storage: options.storage, ragProvider: taskRuntime ? ragProvider() : options.storage.ragProvider, registerRoutes: options.registerRoutes, storageApi: options.storageApi, frontendDist: options.frontendDist, isDev: options.isDev, logger: options.logger, taskRuntime, apiOnly: options.apiOnly, localAccess: options.localAccess }))
    await app.listen({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' })
    const listeningAddress = app.server.address() as AddressInfo
    localEndpoint = `http://127.0.0.1:${listeningAddress.port}`
    taskRuntime?.start()
    if (options.startSchedulers !== false) {
      const acquirers = options.schedulerAcquirers ?? [
        (log) => options.storage.marketplaceScheduler?.acquire(log) ?? acquireClaudeMarketplaceScheduler(log),
        () => acquireLogScheduler(),
      ]
      for (const acquire of acquirers) schedulerDisposers.push(acquire(app.log))
    }
    if (startup) {
      await runInStorageContext(() => startup.cleanupStaleRag())
      await runInStorageContext(() => startup.initializeSkills())
    }
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const dispose of schedulerDisposers.splice(0)) { try { await dispose() } catch (cleanupError) { cleanupErrors.push(cleanupError) } }
    if (app) { try { await runInStorageContext(() => app!.close()) } catch (cleanupError) { cleanupErrors.push(cleanupError) } }
    if (taskRuntime) { try { await taskRuntime.close() } catch (cleanupError) { cleanupErrors.push(cleanupError) } }
    if (ownedRagProvider) { try { await ownedRagProvider.close() } catch (cleanupError) { cleanupErrors.push(cleanupError) } }
    try { await runInStorageContext(() => options.storage.close()) } catch (cleanupError) { cleanupErrors.push(cleanupError) }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Server startup failed and cleanup was incomplete')
    throw error
  }
  const address = app.server.address() as AddressInfo
  let quiesced = false
  let closed = false
  let closePromise: Promise<void> | undefined
  const quiesce = async () => {
    if (quiesced) return
    quiesced = true
    app.quiesceWrites()
    await taskRuntime?.stop()
    await runInStorageContext(() => options.storage.quiesce())
  }
  const handle: MantaServerHandle = {
    port: address.port,
    taskRuntime,
    quiesce,
    close() {
      closePromise ??= (async () => {
        closed = true
        const errors: unknown[] = []
        const attempt = async (operation: () => void | Promise<void>) => {
          try { await operation() } catch (error) { errors.push(error) }
        }
        await attempt(quiesce)
        await attempt(() => taskRuntime?.checkpoint())
        await attempt(() => runInStorageContext(() => options.storage.checkpoint()))
        for (const dispose of schedulerDisposers.splice(0)) await attempt(dispose)
        await attempt(() => runInStorageContext(() => app.close()))
        await attempt(() => taskRuntime?.close())
        await attempt(() => ownedRagProvider?.close())
        await attempt(() => runInStorageContext(() => options.storage.close()))
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Server shutdown failed')
      })()
      return closePromise
    },
    async healthCheck() {
      if (closed) return { ok: false, status: 'unhealthy', warnings: [], error: 'closed' }
      const storageHealth = await options.storage.healthCheck()
      if (!storageHealth.ok) return storageHealth
      const jobsHealth = taskRuntime?.integrityCheck()
      return jobsHealth && !jobsHealth.ok
        ? { ok: false, status: 'unhealthy', warnings: storageHealth.warnings, error: jobsHealth.error }
        : storageHealth
    },
  }
  return handle
}

function defaultStartupHooks(bundledSeedRoot?: string, resolveProvider?: () => BackendStorageRuntime['ragProvider'] | undefined): ServerStartupHooks {
  return {
    async cleanupStaleRag() {
      const owned = !resolveProvider?.()
      const provider = resolveProvider?.() ?? (await import('@manta/rag/qdrant')).createQdrantProvider()
      try {
        await provider.initialize()
        await provider.cleanupStaleDocuments()
      } finally {
        if (owned) await provider.close()
      }
    },
    async initializeSkills() {
      const { seedBundledExtensions } = await import('./storage/extension-seeds.js')
      const { resolveStoragePath } = await import('./storage/path-routing.js')
      const seedRoot = bundledSeedRoot ?? process.env.MANTA_BUNDLED_ASSETS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
      await initializeBundledExtensionsForStartup({
        seed: () => seedBundledExtensions({ extensionsRoot: resolveStoragePath('extensions'), seedRoot, version: process.env.MANTA_BUNDLED_ASSETS_VERSION ?? '2.0.0' }),
        async loadRuntime() {
          const [{ scanPluginFiles }, { registerPlugin }, { initializeSkills }] = await Promise.all([
            import('./core/storage/plugin/scanner.js'), import('./core/storage/plugin/store.js'), import('./core/storage/skill/store.js'),
          ])
          return { scanPlugins: scanPluginFiles, registerPlugin: (scanned: ReturnType<typeof scanPluginFiles>[number]) => registerPlugin(scanned.manifest, scanned.dirPath), initializeSkills }
        },
      })
    },
  }
}

async function runCli(): Promise<void> {
  const bootstrapPath = process.env.MANTA_BOOTSTRAP_PATH
  if (!bootstrapPath) throw new Error('MANTA_BOOTSTRAP_PATH is required for headless startup')
  const { BootstrapStore } = await import('@manta/storage-hub')
  const { createBackendStorageComposition } = await import('./storage/runtime.js')
  const { runtime } = await createBackendStorageComposition(new BootstrapStore(bootstrapPath))
  const handle = await startServer({
    storage: runtime,
    port: Number.parseInt(process.env.MANTA_PORT ?? '3001', 10),
    host: process.env.MANTA_HOST ?? '127.0.0.1',
  })
  const shutdown = async () => { await handle.close() }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => { console.error(error); process.exitCode = 1 })
}
