import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StorageGroupId } from '@manta/shared'
import { BootstrapStore } from '@manta/storage-hub'
import type { ManagedGroupLifecycle } from './group-drivers'

const handles: Array<{ close(): Promise<void> }> = []
afterEach(async () => { await Promise.all(handles.splice(0).map((handle) => handle.close())) })

function fakeStorage(root: string, events: string[] = []) {
  return {
    resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
    async quiesce() { events.push('quiesce') }, async checkpoint() { events.push('checkpoint') },
    async close() { events.push('close') }, async healthCheck() { return { ok: true as const } },
  }
}

describe('backend lifecycle', () => {
  it('shares one driver graph between the hub migrations and backend runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-composition-'))
    const bootstrap = new BootstrapStore(join(root, 'bootstrap.json'))
    const now = new Date().toISOString()
    await bootstrap.write({
      schemaVersion: 1, generation: 1,
      volumes: [{ id: 'default', name: 'Default', parentPath: root, createdAt: now, updatedAt: now }],
      groupAssignments: Object.fromEntries(['config', 'secrets', 'extensions', 'knowledge', 'work', 'diagnostics', 'cache'].map((id) => [id, 'default'])) as Record<StorageGroupId, string>,
    })
    const { createBackendStorageComposition } = await import('./runtime')
    const composition = await createBackendStorageComposition(bootstrap)
    expect(composition.hub.migrations).toBeDefined()
    expect(composition.hub.drivers).toBe(composition.runtime.drivers)
    expect((await composition.hub.migrations!.recoverPending())?.generation).toBe(1)
    await composition.runtime.close()
  })

  it('composes knowledge resources from routed ASH paths and can close them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-runtime-'))
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime({ resolve: (group, ...segments) => join(root, group, ...segments) })
    expect(runtime.drivers?.get('knowledge')).toBeDefined()
    expect((await runtime.healthCheck()).ok).toBe(true)
    await runtime.checkpoint()
    await runtime.close()
    expect((await runtime.healthCheck()).ok).toBe(false)
  })

  it('does not listen merely by importing the server module', async () => {
    const before = { sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') }
    await import('../server')
    expect(process.listenerCount('SIGINT')).toBe(before.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm)
  })

  it('returns the actual dynamic port and quiesces writes before closing resources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-backend-'))
    const events: string[] = []
    let quiesced = false
    const storage = {
      resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
      async quiesce() { quiesced = true; events.push('quiesce') },
      async checkpoint() { events.push('checkpoint') },
      async close() { events.push('close') },
      async healthCheck() { return { ok: true as const } },
    }
    const { startServer } = await import('../server')
    const handle = await startServer({ storage, port: 0, startSchedulers: false, registerRoutes: false, startup: false })
    handles.push(handle)
    expect(handle.port).toBeGreaterThan(0)
    expect((await handle.healthCheck()).ok).toBe(true)
    await handle.quiesce()
    expect(quiesced).toBe(true)
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/not-a-route`, { method: 'POST' })
    expect(response.status).toBe(503)
    expect((await response.json() as any).error.code).toBe('STORAGE_MIGRATION_IN_PROGRESS')
    await handle.close()
    handles.pop()
    expect(events).toEqual(['quiesce', 'checkpoint', 'close'])
  })

  it('attempts every shutdown stage even when an earlier stage fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-backend-failing-close-'))
    const events: string[] = []
    const storage = {
      resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
      async quiesce() { events.push('quiesce'); throw new Error('quiesce failed') },
      async checkpoint() { events.push('checkpoint'); throw new Error('checkpoint failed') },
      async close() { events.push('close') },
      async healthCheck() { return { ok: true as const } },
    }
    const { startServer } = await import('../server')
    const handle = await startServer({ storage, port: 0, startSchedulers: false, registerRoutes: false, startup: false })

    const closeError = await handle.close().catch((error: unknown) => error)
    expect(closeError).toBeInstanceOf(AggregateError)
    expect((closeError as AggregateError).errors.map(String).join('\n')).toMatch(/quiesce failed[\s\S]*checkpoint failed/)
    expect(events).toEqual(['quiesce', 'checkpoint', 'close'])
    await expect(fetch(`http://127.0.0.1:${handle.port}/api/health`)).rejects.toThrow()
  })

  it('cleans storage after a real listen failure caused by a port conflict', async () => {
    const { startServer } = await import('../server')
    const first = await startServer({ storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-port-a-'))), port: 0, registerRoutes: false, startSchedulers: false, startup: false })
    handles.push(first)
    const events: string[] = []
    await expect(startServer({ storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-port-b-')), events), port: first.port, registerRoutes: false, startSchedulers: false, startup: false })).rejects.toThrow()
    expect(events).toEqual(['close'])
  })

  it('cleans storage when application construction fails', async () => {
    const { startServer } = await import('../server')
    const events: string[] = []
    await expect(startServer({
      storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-build-fail-')), events),
      appFactory: async () => { throw new Error('route import failed') }, startup: false,
    })).rejects.toThrow(/route import failed/)
    expect(events).toEqual(['close'])
  })

  it('uses owner-scoped scheduler disposers across interleaved servers and restart', async () => {
    const { startServer } = await import('../server')
    let owners = 0
    const acquire = () => { owners += 1; let active = true; return () => { if (active) { active = false; owners -= 1 } } }
    const make = () => startServer({ storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-owner-'))), port: 0, registerRoutes: false, startup: false, schedulerAcquirers: [acquire] })
    const first = await make(); const second = await make()
    expect(owners).toBe(2)
    await first.close(); expect(owners).toBe(1)
    await second.close(); expect(owners).toBe(0)
    const restarted = await make(); expect(owners).toBe(1)
    await restarted.close(); expect(owners).toBe(0)
  })

  it('runs explicit startup initialization and cleans up if it fails', async () => {
    const { startServer } = await import('../server')
    const events: string[] = []
    await expect(startServer({
      storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-startup-')), events), port: 0, registerRoutes: false, startSchedulers: false,
      startup: { async cleanupStaleRag() { events.push('stale') }, async initializeSkills() { events.push('skills'); throw new Error('skill initialization failed') } },
    })).rejects.toThrow(/skill initialization failed/)
    expect(events).toEqual(['stale', 'skills', 'close'])
  })

  it('quiesces and reopens extension and diagnostics lifecycle owners', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-group-lifecycle-'))
    const events: string[] = []
    const lifecycle = (name: string): ManagedGroupLifecycle => ({
      quiesce() { events.push(`${name}:quiesce`) }, checkpoint() { events.push(`${name}:checkpoint`) },
      close() { events.push(`${name}:close`) }, reopen() { events.push(`${name}:reopen`) }, dispose() { events.push(`${name}:dispose`) },
    })
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime(fakeStorage(root), { groupLifecycles: { extensions: lifecycle('extensions'), diagnostics: lifecycle('diagnostics') } })
    for (const id of ['extensions', 'diagnostics'] as const) {
      const driver = runtime.drivers.get(id)!
      await driver.quiesce(); await driver.checkpoint(); await driver.close(); await driver.reopen(join(root, id))
    }
    expect(events).toContain('extensions:quiesce'); expect(events).toContain('extensions:reopen')
    expect(events).toContain('diagnostics:quiesce'); expect(events).toContain('diagnostics:reopen')
    await runtime.close()
  })

  it('resets RAG even if a group close fails, allowing a fresh runtime', async () => {
    const { createBackendStorageRuntime } = await import('./runtime')
    const failing: ManagedGroupLifecycle = { quiesce() {}, checkpoint() {}, close() { throw new Error('diagnostics close failed') }, reopen() {}, dispose() {} }
    const first = createBackendStorageRuntime(fakeStorage(mkdtempSync(join(tmpdir(), 'manta-reset-a-'))), { groupLifecycles: { diagnostics: failing } })
    await expect(first.close()).rejects.toThrow(/diagnostics close failed/)
    const second = createBackendStorageRuntime(fakeStorage(mkdtempSync(join(tmpdir(), 'manta-reset-b-'))))
    expect((await second.healthCheck()).ok).toBe(true)
    await second.close()
  })
})
