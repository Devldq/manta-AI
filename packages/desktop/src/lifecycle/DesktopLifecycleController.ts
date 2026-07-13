import type { AshBootstrap } from '@manta/shared'
import type { RelaunchIntent } from './StorageControlStore'
interface MantaServerHandle { readonly port: number; quiesce(): Promise<void>; close(): Promise<void>; healthCheck(): Promise<{ ok: boolean; error?: string }> }

export interface StartupFailure { ok: false; error: { code: string; message: string; retryable: boolean } }
export interface DesktopLifecycleDependencies {
  readBootstrap(): Promise<AshBootstrap | undefined>
  recover(): Promise<unknown>
  composeStorage(): Promise<{ runtime: unknown; hub: { migrations?: unknown } }>
  startServer(options: { storage: unknown; bundledSeedRoot: string }): Promise<MantaServerHandle>
  openOnboarding(): Promise<unknown>
  openMain(url: string): Promise<unknown>
  readRelaunchIntent(): Promise<RelaunchIntent | undefined>
  prepareRelaunch(operationId: string): Promise<void>
  rollbackRelaunchIntent(intent: RelaunchIntent): Promise<void>
  completeRelaunchOperation(operationId: string): Promise<void>
  clearRelaunchIntent(): Promise<void>
  resetComposition(): Promise<void> | void
  quit(): void
  relaunch(): void
  seedRoot: string
}

export class DesktopLifecycleController {
  private server?: MantaServerHandle
  private starting?: Promise<{ ok: true } | StartupFailure>
  constructor(private readonly deps: DesktopLifecycleDependencies) {}

  start(): Promise<{ ok: true } | StartupFailure> {
    return this.starting ??= this.doStart().finally(() => { this.starting = undefined })
  }
  retry(): Promise<{ ok: true } | StartupFailure> { return this.start() }

  private async doStart(): Promise<{ ok: true } | StartupFailure> {
    let intent: RelaunchIntent | undefined
    try {
      intent = await this.deps.readRelaunchIntent().catch((error) => { throw Object.assign(error as Error, { code: 'RELAUNCH_INTENT_INVALID' }) })
      if (intent && intent.phase !== 'awaiting-new-process-health') {
        await this.deps.rollbackRelaunchIntent(intent); await this.deps.resetComposition(); await this.bootOnce(true); await this.deps.clearRelaunchIntent(); return { ok:true }
      }
      await this.bootOnce(Boolean(intent)); if (intent) { await this.deps.completeRelaunchOperation(intent.operationId); await this.deps.clearRelaunchIntent() } return { ok: true }
    } catch (firstError) {
      await this.closeFailedServer()
      await this.resetAfterFailedStart()
      if (intent?.phase === 'awaiting-new-process-health' && intent.attempt === 0) {
        try {
          await this.deps.rollbackRelaunchIntent(intent); await this.deps.resetComposition(); await this.bootOnce(true); await this.deps.clearRelaunchIntent(); return { ok: true }
        } catch (rollbackError) { await this.closeFailedServer(); return this.failure(new AggregateError([firstError, rollbackError], 'New location failed and old-location recovery did not start')) }
      }
      return this.failure(firstError)
    }
  }

  private async bootOnce(requireInitialized: boolean): Promise<void> {
    if (!await this.deps.readBootstrap()) { if (requireInitialized) throw new Error('Relaunch recovery Bootstrap is missing'); await this.deps.openOnboarding(); return }
    await this.deps.recover(); const composition = await this.deps.composeStorage()
    this.server = await this.deps.startServer({ storage: composition.runtime, bundledSeedRoot: this.deps.seedRoot })
    const health = await this.server.healthCheck(); if (!health.ok) throw Object.assign(new Error(health.error ?? 'Storage health check failed'), { code: 'STORAGE_UNHEALTHY' })
    await this.deps.openMain(`http://127.0.0.1:${this.server.port}`)
  }
  private async closeFailedServer(): Promise<void> { if (this.server) { try { await this.server.close() } catch { /* preserve authoritative startup error */ } this.server=undefined } }
  /** Release every runtime owned by a failed boot before a retry can recover again. */
  private async resetAfterFailedStart(): Promise<void> { try { await this.deps.resetComposition() } catch { /* preserve authoritative startup error */ } }
  private failure(error: unknown): StartupFailure { return { ok:false, error:{ code:(error as any).code ?? 'STARTUP_FAILED', message:(error as Error).message, retryable:true } } }

  async migrateAndRelaunch(operation: () => Promise<string>): Promise<string> {
    const id = await operation(); await this.relaunchAfterMigration(id)
    return id
  }

  /** The migration has already committed; make its relaunch durable before quitting. */
  async relaunchAfterMigration(id: string): Promise<void> {
    await this.deps.prepareRelaunch(id)
    this.deps.relaunch(); this.deps.quit()
  }

  async shutdown(): Promise<void> {
    const errors: unknown[] = []
    const server = this.server
    if (server) for (const operation of [() => server.quiesce(), () => server.close()]) try { await operation() } catch (error) { errors.push(error) }
    this.server = undefined
    try { await this.deps.resetComposition() } catch (error) { errors.push(error) }
    if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, 'Desktop shutdown failed')
  }
}
