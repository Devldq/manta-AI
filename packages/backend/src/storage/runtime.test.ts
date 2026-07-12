import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageGroupId } from '@manta/shared'
import { BootstrapStore } from '@manta/storage-hub'
import type { ManagedGroupLifecycle } from './group-drivers'
import { RuntimeDiagnosticsWriter } from './runtime-diagnostics'
import { createClaudeMarketplaceRuntimeOwner } from '../core/storage/plugin/marketplace'
import { logFileWriter } from '../core/observability/log/file-writer'
import { runWithDiagnosticsOwner } from './runtime-diagnostics'

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

  it('releases scheduler owners acquired before a later acquirer throws', async () => {
    const { startServer } = await import('../server')
    let owners = 0
    const events: string[] = []
    await expect(startServer({
      storage: fakeStorage(mkdtempSync(join(tmpdir(), 'manta-owner-failure-')), events), port: 0, registerRoutes: false, startup: false,
      schedulerAcquirers: [
        () => { owners += 1; return () => { owners -= 1 } },
        () => { throw new Error('second scheduler failed') },
      ],
    })).rejects.toThrow(/second scheduler failed/)
    expect(owners).toBe(0)
    expect(events).toEqual(['close'])
  })

  it('runs explicit startup initialization and cleans up if it fails', async () => {
    const { startServer } = await import('../server')
    const events: string[] = []
    const diagnosticsRoot = mkdtempSync(join(tmpdir(), 'manta-startup-diagnostics-'))
    const diagnosticsWriter = new RuntimeDiagnosticsWriter(diagnosticsRoot)
    const storage = Object.assign(fakeStorage(mkdtempSync(join(tmpdir(), 'manta-startup-')), events), {
      diagnosticsWriter,
      runInStorageContext: <T>(operation: () => T) => runWithDiagnosticsOwner(diagnosticsWriter, operation),
    })
    await expect(startServer({
      storage, port: 0, registerRoutes: false, startSchedulers: false,
      startup: {
        async cleanupStaleRag() { events.push('stale'); logFileWriter.appendToFile({ id: 'startup-owned', timestamp: new Date().toISOString() }) },
        async initializeSkills() { events.push('skills'); throw new Error('skill initialization failed') },
      },
    })).rejects.toThrow(/skill initialization failed/)
    expect(events).toEqual(['stale', 'skills', 'close'])
    expect(readFileSync(join(diagnosticsRoot, 'system.log'), 'utf8')).toContain('startup-owned')
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

  it('buffers only the migrating diagnostics owner while another runtime keeps writing', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'manta-diagnostics-a-'))
    const nextRoot = mkdtempSync(join(tmpdir(), 'manta-diagnostics-a-next-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'manta-diagnostics-b-'))
    const first = new RuntimeDiagnosticsWriter(firstRoot)
    const second = new RuntimeDiagnosticsWriter(secondRoot)
    first.append({ id: 'a-before', timestamp: new Date().toISOString() })
    first.quiesce()
    first.append({ id: 'a-buffered', timestamp: new Date().toISOString() })
    second.append({ id: 'b-during-a-migration', timestamp: new Date().toISOString() })
    expect(readFileSync(join(secondRoot, 'system.log'), 'utf8')).toContain('b-during-a-migration')
    expect(readFileSync(join(firstRoot, 'system.log'), 'utf8')).not.toContain('a-buffered')
    expect(existsSync(join(nextRoot, 'system.log'))).toBe(false)
    first.reopen(nextRoot)
    expect(readFileSync(join(nextRoot, 'system.log'), 'utf8')).toContain('a-buffered')
  })

  it('pauses only the migrating marketplace owner and resumes its routed cache', async () => {
    const calls: string[] = []
    const refresh = async (dataDir: string) => { calls.push(dataDir); return { sourceUrl: 'test', refreshedAt: new Date().toISOString(), items: [] } as any }
    const first = createClaudeMarketplaceRuntimeOwner('extensions-a/marketplace', refresh)
    const second = createClaudeMarketplaceRuntimeOwner('extensions-b/marketplace', refresh)
    const resumeFirst = first.pause()
    const releaseFirst = first.acquire()
    const releaseSecond = second.acquire()
    await Promise.resolve()
    expect(calls).toContain('extensions-b/marketplace')
    expect(calls).not.toContain('extensions-a/marketplace')
    resumeFirst()
    await Promise.resolve()
    expect(calls).toContain('extensions-a/marketplace')
    releaseSecond(); releaseFirst(); first.dispose(); second.dispose()
  })

  it('atomically rebinds the extensions driver marketplace cache before resuming', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-marketplace-rebind-'))
    const nextExtensions = mkdtempSync(join(tmpdir(), 'manta-marketplace-next-'))
    let revision = 0
    const refresh = async (dataDir: string) => {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'claude.json'), `revision-${++revision}`, 'utf8')
      return { sourceUrl: 'test', refreshedAt: new Date().toISOString(), items: [] } as any
    }
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime(fakeStorage(root), { marketplaceRefresh: refresh })
    const release = runtime.marketplaceScheduler.acquire()
    await runtime.marketplaceScheduler.checkpoint()
    const oldFile = join(root, 'extensions', 'plugin-marketplace', 'claude.json')
    const oldContent = readFileSync(oldFile, 'utf8')
    const driver = runtime.drivers.get('extensions')!
    await driver.quiesce(); await driver.checkpoint(); await driver.reopen(nextExtensions)
    await runtime.marketplaceScheduler.checkpoint()
    expect(readFileSync(oldFile, 'utf8')).toBe(oldContent)
    expect(readFileSync(join(nextExtensions, 'plugin-marketplace', 'claude.json'), 'utf8')).not.toBe(oldContent)
    release(); await runtime.close()
  })

  it('persists only inside explicit diagnostics owner contexts, including inherited timers', async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'manta-context-a-'))
    const secondRoot = mkdtempSync(join(tmpdir(), 'manta-context-b-'))
    const first = new RuntimeDiagnosticsWriter(firstRoot)
    const second = new RuntimeDiagnosticsWriter(secondRoot)
    expect(logFileWriter.getLogFilePath()).toBe('')
    logFileWriter.appendToFile({ id: 'unowned', timestamp: new Date().toISOString() })
    expect(existsSync(join(firstRoot, 'system.log'))).toBe(false)
    await new Promise<void>((resolve) => runWithDiagnosticsOwner(first, () => setTimeout(() => {
      logFileWriter.appendToFile({ id: 'timer-a', timestamp: new Date().toISOString() }); resolve()
    }, 0)))
    runWithDiagnosticsOwner(second, () => logFileWriter.appendToFile({ id: 'background-b', timestamp: new Date().toISOString() }))
    expect(readFileSync(join(firstRoot, 'system.log'), 'utf8')).toContain('timer-a')
    expect(readFileSync(join(firstRoot, 'system.log'), 'utf8')).not.toContain('background-b')
    expect(readFileSync(join(secondRoot, 'system.log'), 'utf8')).toContain('background-b')
  })

  it('makes diagnostics disposal permanent and idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-diagnostics-dispose-'))
    const writer = new RuntimeDiagnosticsWriter(root)
    writer.quiesce()
    expect(writer.append({ id: 'accepted-before-dispose', timestamp: new Date().toISOString() })).toBe(true)
    writer.dispose()
    const content = readFileSync(join(root, 'system.log'), 'utf8')
    expect(content).toContain('accepted-before-dispose')
    expect(writer.append({ id: 'late-after-dispose', timestamp: new Date().toISOString() })).toBe(false)
    writer.quiesce(); writer.checkpoint(); writer.close(); writer.dispose()
    expect(() => writer.reopen(root)).toThrow(/disposed/i)
    expect(readFileSync(join(root, 'system.log'), 'utf8')).toBe(content)
  })

  it('rejects promise continuations that retain ALS after server close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-late-context-'))
    const { createBackendStorageRuntime } = await import('./runtime')
    const { startServer } = await import('../server')
    const runtime = createBackendStorageRuntime(fakeStorage(root))
    runtime.runInStorageContext(() => logFileWriter.appendToFile({ id: 'before-close', timestamp: new Date().toISOString() }))
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const late = runtime.runInStorageContext(async () => {
      await gate
      logFileWriter.appendToFile({ id: 'late-after-close', timestamp: new Date().toISOString() })
    })
    const handle = await startServer({ storage: runtime, port: 0, registerRoutes: false, startSchedulers: false, startup: false })
    await handle.close()
    const file = join(root, 'diagnostics', 'system.log')
    const closedContent = readFileSync(file, 'utf8')
    release(); await late
    expect(readFileSync(file, 'utf8')).toBe(closedContent)
    expect(closedContent).not.toContain('late-after-close')
  })

  it('runs global marketplace ticks without capturing the first owner context', async () => {
    vi.useFakeTimers()
    try {
      const roots = ['a', 'b', 'c'].map((name) => mkdtempSync(join(tmpdir(), `manta-tick-${name}-`)))
      const writers = roots.map((root) => new RuntimeDiagnosticsWriter(root))
      const calls: string[] = []
      const owner = (index: number) => createClaudeMarketplaceRuntimeOwner(
        join(roots[index], 'marketplace'),
        async () => {
          const id = ['a', 'b', 'c'][index]; calls.push(id)
          logFileWriter.appendToFile({ id: `tick-${id}`, timestamp: new Date().toISOString() })
          return { sourceUrl: 'test', refreshedAt: new Date().toISOString(), items: [] } as any
        },
        (operation) => runWithDiagnosticsOwner(writers[index], operation),
      )
      const first = owner(0); const second = owner(1)
      const releaseFirst = first.acquire(); const releaseSecond = second.acquire()
      await Promise.resolve(); calls.length = 0
      releaseFirst()
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
      expect(calls).toEqual(['b'])
      expect(readFileSync(join(roots[1], 'system.log'), 'utf8')).toContain('tick-b')
      expect(readFileSync(join(roots[0], 'system.log'), 'utf8')).not.toContain('tick-b')
      releaseSecond(); calls.length = 0
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
      expect(calls).toEqual([])
      const third = owner(2); const releaseThird = third.acquire(); await Promise.resolve()
      expect(calls).toEqual(['c'])
      releaseThird(); first.dispose(); second.dispose(); third.dispose()
    } finally { vi.useRealTimers() }
  })
})
