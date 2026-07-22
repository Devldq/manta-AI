import type { AshBootstrap } from '@manta/shared'
import type { RelaunchIntent } from './StorageControlStore'
import type { OnboardingProgressReporter, OnboardingProgressStepId } from '../onboarding/progress-contract'
interface MantaServerHandle { readonly port: number; readonly rendererUrl?: string; quiesce(): Promise<void>; close(): Promise<void>; healthCheck(): Promise<{ ok: boolean; error?: string }> }

export interface StartupFailure { ok: false; error: { code: string; message: string; retryable: boolean } }
export interface DesktopLifecycleDependencies {
  readBootstrap(): Promise<AshBootstrap | undefined>
  preflightStorage(...bootstraps: AshBootstrap[]): Promise<void>
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

  continueAfterOnboarding(onProgress?: OnboardingProgressReporter): Promise<{ ok: true } | StartupFailure> {
    return this.starting ??= this.doContinueAfterOnboarding(onProgress).finally(() => { this.starting = undefined })
  }

  private async doContinueAfterOnboarding(onProgress?: OnboardingProgressReporter): Promise<{ ok: true } | StartupFailure> {
    try {
      await this.bootOnce(true, onProgress)
      return { ok: true }
    } catch (error) {
      await this.closeFailedServer()
      await this.resetAfterFailedStart()
      return this.failure(error)
    }
  }

  private async doStart(): Promise<{ ok: true } | StartupFailure> {
    let intent: RelaunchIntent | undefined
    try {
      const bootstrap = await this.deps.readBootstrap()
      if (!bootstrap) { await this.deps.openOnboarding(); return { ok: true } }
      await this.deps.preflightStorage(bootstrap)
      const candidateIntent = await this.deps.readRelaunchIntent().catch((error) => { throw Object.assign(error as Error, { code: 'RELAUNCH_INTENT_INVALID' }) })
      if (candidateIntent) await this.deps.preflightStorage(candidateIntent.previous, candidateIntent.current)
      intent = candidateIntent
      if (intent && intent.phase !== 'awaiting-new-process-health') {
        await this.deps.rollbackRelaunchIntent(intent); await this.deps.resetComposition(); await this.bootOnce(true); await this.deps.clearRelaunchIntent(); return { ok:true }
      }
      await this.bootOnce(Boolean(intent), undefined, bootstrap); if (intent) { await this.deps.completeRelaunchOperation(intent.operationId); await this.deps.clearRelaunchIntent() } return { ok: true }
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

  private async bootOnce(requireInitialized: boolean, onProgress?: OnboardingProgressReporter, preparedBootstrap?: AshBootstrap): Promise<void> {
    const bootstrap = preparedBootstrap ?? await this.deps.readBootstrap()
    if (!bootstrap) { if (requireInitialized) throw new Error('Relaunch recovery Bootstrap is missing'); await this.deps.openOnboarding(); return }
    if (!preparedBootstrap) await this.deps.preflightStorage(bootstrap)
    const composition = await this.runProgressStep('initialize-services', onProgress, async () => {
      await this.deps.recover()
      return this.deps.composeStorage()
    })
    await this.runProgressStep('start-backend', onProgress, async () => {
      this.server = await this.deps.startServer({ storage: composition.runtime, bundledSeedRoot: this.deps.seedRoot })
      const health = await this.server.healthCheck()
      if (!health.ok) throw Object.assign(new Error(health.error ?? 'Storage health check failed'), { code: 'STORAGE_UNHEALTHY' })
    })
    await this.runProgressStep('open-main', onProgress, () => this.deps.openMain(this.server!.rendererUrl ?? `http://127.0.0.1:${this.server!.port}`))
  }
  private async runProgressStep<T>(step: OnboardingProgressStepId, report: OnboardingProgressReporter | undefined, operation: () => Promise<T>): Promise<T> {
    report?.({ step, state: 'active' })
    try {
      const result = await operation()
      report?.({ step, state: 'complete' })
      return result
    } catch (error) {
      report?.({ step, state: 'failed' })
      throw error
    }
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
