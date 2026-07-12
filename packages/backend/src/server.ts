import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildApp, type BuildAppOptions } from './app'
import type { BackendStorageRuntime, StorageHealthResult } from './storage/runtime'
import { acquireClaudeMarketplaceScheduler } from './core/storage/plugin/marketplace'
import { acquireLogScheduler } from './core/observability/log/index'
import type { FastifyInstance } from 'fastify'
import type { StorageApiContext } from './routes/storage'

export { createBackendStorageComposition } from './storage/runtime'

export interface ServerStartupHooks {
  cleanupStaleRag(): void | Promise<void>
  initializeSkills(): void | Promise<void>
}

export type ManagedBackendStorage = Omit<BackendStorageRuntime, 'drivers' | 'diagnosticsWriter' | 'marketplaceScheduler' | 'processRegistry' | 'runInStorageContext' | 'legacyRecoveryWarnings'> &
  Partial<Pick<BackendStorageRuntime, 'diagnosticsWriter' | 'marketplaceScheduler' | 'runInStorageContext'>>

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
}

export interface MantaServerHandle {
  readonly port: number
  quiesce(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<StorageHealthResult>
}

export async function startServer(options: StartServerOptions): Promise<MantaServerHandle> {
  let app: FastifyInstance | undefined
  const schedulerDisposers: Array<() => void | Promise<void>> = []
  const startup = options.startup === false ? undefined : options.startup ?? defaultStartupHooks(options.bundledSeedRoot)
  const runInStorageContext = <T>(operation: () => T): T => options.storage.runInStorageContext
    ? options.storage.runInStorageContext(operation)
    : operation()
  try {
    app = await runInStorageContext(() => (options.appFactory ?? buildApp)({ storage: options.storage, registerRoutes: options.registerRoutes, storageApi: options.storageApi, frontendDist: options.frontendDist, isDev: options.isDev }))
    await app.listen({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' })
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
    await runInStorageContext(() => options.storage.quiesce())
  }
  const handle: MantaServerHandle = {
    port: address.port,
    quiesce,
    close() {
      closePromise ??= (async () => {
        closed = true
        const errors: unknown[] = []
        const attempt = async (operation: () => void | Promise<void>) => {
          try { await operation() } catch (error) { errors.push(error) }
        }
        await attempt(quiesce)
        await attempt(() => runInStorageContext(() => options.storage.checkpoint()))
        for (const dispose of schedulerDisposers.splice(0)) await attempt(dispose)
        await attempt(() => runInStorageContext(() => app.close()))
        await attempt(() => runInStorageContext(() => options.storage.close()))
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Server shutdown failed')
      })()
      return closePromise
    },
    async healthCheck() {
      if (closed) return { ok: false, status: 'unhealthy', warnings: [], error: 'closed' }
      return options.storage.healthCheck()
    },
  }
  return handle
}

function defaultStartupHooks(bundledSeedRoot?: string): ServerStartupHooks {
  return {
    async cleanupStaleRag() {
      const { getSQLiteVecProvider } = await import('@manta/rag')
      const provider = getSQLiteVecProvider()
      await provider.initialize()
      await provider.cleanupStaleDocuments()
    },
    async initializeSkills() {
      const { seedBundledExtensions } = await import('./storage/extension-seeds.js')
      const { resolveStoragePath } = await import('./storage/path-routing.js')
      const seedRoot = bundledSeedRoot ?? process.env.MANTA_BUNDLED_ASSETS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
      seedBundledExtensions({ extensionsRoot: resolveStoragePath('extensions'), seedRoot, version: process.env.MANTA_BUNDLED_ASSETS_VERSION ?? '2.0.0' })
      const [{ scanPluginFiles }, { registerPlugin }] = await Promise.all([
        import('./core/storage/plugin/scanner.js'), import('./core/storage/plugin/store.js'),
      ])
      for (const scanned of scanPluginFiles()) registerPlugin(scanned.manifest, scanned.dirPath)
      const { initializeSkills } = await import('./core/storage/skill/store.js')
      initializeSkills()
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
