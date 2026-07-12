import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { buildApp } from './app'
import type { BackendStorageRuntime } from './storage/runtime'
import { startClaudeMarketplaceScheduler, stopClaudeMarketplaceScheduler } from './core/storage/plugin/marketplace'

export interface StartServerOptions {
  storage: BackendStorageRuntime
  port?: number
  host?: string
  startSchedulers?: boolean
  registerRoutes?: boolean
}

export interface MantaServerHandle {
  readonly port: number
  quiesce(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
}

export async function startServer(options: StartServerOptions): Promise<MantaServerHandle> {
  const app = await buildApp({ storage: options.storage, registerRoutes: options.registerRoutes })
  await app.listen({ port: options.port ?? 0, host: options.host ?? '127.0.0.1' })
  const address = app.server.address() as AddressInfo
  if (options.startSchedulers !== false) startClaudeMarketplaceScheduler(app.log)
  let quiesced = false
  let closed = false
  const quiesce = async () => {
    if (quiesced) return
    quiesced = true
    app.quiesceWrites()
    await options.storage.quiesce()
  }
  const handle: MantaServerHandle = {
    port: address.port,
    quiesce,
    async close() {
      if (closed) return
      closed = true
      const errors: unknown[] = []
      const attempt = async (operation: () => void | Promise<void>) => {
        try { await operation() } catch (error) { errors.push(error) }
      }
      await attempt(quiesce)
      await attempt(() => options.storage.checkpoint())
      await attempt(() => stopClaudeMarketplaceScheduler())
      if (options.registerRoutes !== false) await attempt(async () => {
        const { stopLogSchedulers } = await import('./core/observability/log/index.js')
        stopLogSchedulers()
      })
      await attempt(() => app.close())
      await attempt(() => options.storage.close())
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Server shutdown failed')
    },
    async healthCheck() {
      if (closed) return { ok: false, error: 'closed' }
      return options.storage.healthCheck()
    },
  }
  return handle
}

async function runCli(): Promise<void> {
  const bootstrapPath = process.env.MANTA_BOOTSTRAP_PATH
  if (!bootstrapPath) throw new Error('MANTA_BOOTSTRAP_PATH is required for headless startup')
  const { BootstrapStore, createStorageHub } = await import('@manta/storage-hub')
  const { createBackendStorageRuntime } = await import('./storage/runtime.js')
  const hub = await createStorageHub({ bootstrap: new BootstrapStore(bootstrapPath) })
  const handle = await startServer({
    storage: createBackendStorageRuntime(hub),
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
