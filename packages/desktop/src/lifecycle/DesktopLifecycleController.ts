import type { AshBootstrap } from '@manta/shared'
interface MantaServerHandle { readonly port: number; quiesce(): Promise<void>; close(): Promise<void>; healthCheck(): Promise<{ ok: boolean; error?: string }> }

export interface StartupFailure { ok: false; error: { code: string; message: string; retryable: boolean } }
export interface DesktopLifecycleDependencies {
  readBootstrap(): Promise<AshBootstrap | undefined>
  recover(): Promise<unknown>
  composeStorage(): Promise<{ runtime: unknown; hub: { migrations?: unknown } }>
  startServer(options: { storage: unknown; bundledSeedRoot: string }): Promise<MantaServerHandle>
  openOnboarding(): Promise<unknown>
  openMain(url: string): Promise<unknown>
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
    try {
      if (!await this.deps.readBootstrap()) { await this.deps.openOnboarding(); return { ok: true } }
      await this.deps.recover(); const composition = await this.deps.composeStorage()
      this.server = await this.deps.startServer({ storage: composition.runtime, bundledSeedRoot: this.deps.seedRoot })
      const health = await this.server.healthCheck(); if (!health.ok) throw Object.assign(new Error(health.error ?? 'Storage health check failed'), { code: 'STORAGE_UNHEALTHY' })
      await this.deps.openMain(`http://127.0.0.1:${this.server.port}`); return { ok: true }
    } catch (error) {
      if (this.server) { try { await this.server.close() } catch { /* original startup error remains authoritative */ } this.server = undefined }
      return { ok: false, error: { code: (error as any).code ?? 'STARTUP_FAILED', message: (error as Error).message, retryable: true } }
    }
  }

  async migrateAndRelaunch(operation: () => Promise<string>, rollback?: () => Promise<void>): Promise<string> {
    const id = await operation(); const health = await this.server?.healthCheck()
    if (health && !health.ok) {
      const message = health.error ?? 'New storage location failed health verification'; const errors: unknown[] = []
      if (this.server) { for (const operation of [() => this.server!.quiesce(), () => this.server!.close()]) try { await operation() } catch (error) { errors.push(error) }; this.server = undefined }
      try { await rollback?.() } catch (error) { errors.push(error) }
      if (!errors.length && rollback) { this.deps.relaunch(); this.deps.quit() }
      if (errors.length) throw new AggregateError([new Error(message), ...errors], 'Migration health rollback failed')
      throw new Error(message)
    }
    this.deps.relaunch(); this.deps.quit(); return id
  }

  async shutdown(): Promise<void> {
    if (!this.server) return
    const errors: unknown[] = []
    for (const operation of [() => this.server!.quiesce(), () => this.server!.close()]) try { await operation() } catch (error) { errors.push(error) }
    this.server = undefined
    if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, 'Desktop shutdown failed')
  }
}
