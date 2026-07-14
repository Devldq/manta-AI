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
import { transactionalInstallDirectory } from './extension-transactions'

const handles: Array<{ close(): Promise<void> }> = []
afterEach(async () => { await Promise.all(handles.splice(0).map((handle) => handle.close())) })

function fakeStorage(root: string, events: string[] = []) {
  return {
    resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
    async quiesce() { events.push('quiesce') }, async checkpoint() { events.push('checkpoint') },
    async close() { events.push('close') }, async healthCheck() { return { ok: true as const, status: 'healthy' as const, warnings: [] } },
  }
}

describe('backend lifecycle', () => {
  it('awaits storage recovery before building or listening on the application', async () => {
    const events: string[] = []
    const storage = Object.assign(fakeStorage(mkdtempSync(join(tmpdir(), 'manta-startup-recovery-')), events), {
      async recoverStartup() { events.push('recover:start'); await Promise.resolve(); events.push('recover:end') },
    })
    const { startServer } = await import('../server')
    const { buildApp } = await import('../app')
    const handle = await startServer({ storage, port: 0, registerRoutes: false, startSchedulers: false, startup: false, appFactory: async (options) => { events.push('build'); return buildApp(options) } })
    handles.push(handle)
    expect(events.slice(0, 3)).toEqual(['recover:start', 'recover:end', 'build'])
  })

  it('automatically recovers extension transactions at startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-runtime-extension-recover-')); const source = join(root, 'source'); const extensions = join(root, 'extensions'); const destination = join(extensions, 'plugins', 'demo')
    mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    expect(() => transactionalInstallDirectory({ extensionsRoot: extensions, source, destination, fault: (phase) => { if (phase === 'after-backup') throw new Error('crash') } })).toThrow('crash')
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime({ resolve: (group, ...segments) => join(root, group, ...segments) }); handles.push(runtime)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new')
  })
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

  it('composes pending migration inspection into capacity metrics for source and target volumes', async () => {
    const base = mkdtempSync(join(tmpdir(), 'manta-capacity-composition-')); const source = join(base, 'source'); const target = join(base, 'target'); mkdirSync(source); mkdirSync(target)
    const bootstrap = new BootstrapStore(join(base, 'bootstrap.json')); const now = new Date().toISOString(); const groups = ['config', 'secrets', 'extensions', 'knowledge', 'work', 'diagnostics', 'cache'] as StorageGroupId[]
    const snapshot = { generation: 1, volumes: [{ id: 'source', name: 'Source', parentPath: source, createdAt: now, updatedAt: now }, { id: 'target', name: 'Target', parentPath: target, createdAt: now, updatedAt: now }], groupAssignments: Object.fromEntries(groups.map((id) => [id, 'source'])) as Record<StorageGroupId, string> }
    await bootstrap.write({ schemaVersion: 1, ...snapshot, previous: snapshot, pendingMigration: { id: 'move', kind: 'group', sourceVolumeId: 'source', targetVolumeId: 'target', groups: ['work'], sourceGeneration: 1, targetGeneration: 2, phase: 'copying', filesCompleted: 0, filesTotal: 1, bytesCompleted: 0, bytesTotal: 1 } })
    const { createBackendStorageComposition } = await import('./runtime'); const composition = await createBackendStorageComposition(bootstrap)
    const metrics = await composition.hub.capacityMetrics()
    expect(metrics.volumes).toEqual(expect.arrayContaining([expect.objectContaining({ volumeId: 'source', scanStatus: 'degraded', verifiedDedupSavedBytes: null }), expect.objectContaining({ volumeId: 'target', scanStatus: 'degraded', verifiedDedupSavedBytes: null })]))
    expect(metrics.volumes.every((item) => item.blockers.some((blocker) => blocker.detail.includes('migration')))).toBe(true)
    await composition.runtime.close()
  })

  it('preserves an unreadable Git staging blocker through the pending inspector and capacity DTO', async () => {
    const base = mkdtempSync(join(tmpdir(), 'manta-capacity-git-blocker-')); const parent = join(base, 'volume'); mkdirSync(parent)
    const bootstrap = new BootstrapStore(join(base, 'bootstrap.json')); const now = new Date().toISOString(); const groups = ['config', 'secrets', 'extensions', 'knowledge', 'work', 'diagnostics', 'cache'] as StorageGroupId[]
    await bootstrap.write({ schemaVersion: 1, generation: 1, volumes: [{ id: 'default', name: 'Default', parentPath: parent, createdAt: now, updatedAt: now }], groupAssignments: Object.fromEntries(groups.map((id) => [id, 'default'])) as Record<StorageGroupId, string> })
    const stagingRoot = join(parent, '.manta-ai', 'cache', 'git-sync', 'default', '.ash', 'sync', 'import-staging')
    mkdirSync(join(stagingRoot, '..'), { recursive: true }); writeFileSync(stagingRoot, 'not a directory')
    const { createBackendStorageComposition } = await import('./runtime'); const composition = await createBackendStorageComposition(bootstrap)
    const metrics = await composition.hub.capacityMetrics(); const result = metrics.volumes.find((item) => item.volumeId === 'default')
    expect(result).toMatchObject({ scanStatus: 'degraded', physicalImmutableBytes: null, verifiedDedupSavedBytes: null })
    expect(result?.blockers).toContainEqual({ code: 'git-import-unreadable', path: stagingRoot, detail: 'Git import staging root is not an ordinary directory' })
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

  it('registers the process registry with the work migration driver', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-process-runtime-'))
    const nextWork = mkdtempSync(join(tmpdir(), 'manta-process-runtime-next-'))
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime({ resolve: (group, ...segments) => join(root, group, ...segments) })
    runtime.processRegistry.register('before', 42, 'agent')
    const driver = runtime.drivers.get('work')!
    await driver.checkpoint(); await driver.close(); await driver.reopen(nextWork)
    expect(runtime.processRegistry.getAllProcesses()).toEqual([])
    runtime.processRegistry.register('after', 43, 'agent')
    await driver.checkpoint()
    expect(readFileSync(join(nextWork, 'processes', 'process-registry.json'), 'utf8')).toContain('after')
    await runtime.close()
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
      async healthCheck() { return { ok: true as const, status: 'healthy' as const, warnings: [] } },
    }
    const { startServer } = await import('../server')
    const handle = await startServer({ storage, port: 0, startSchedulers: false, registerRoutes: false, startup: false })
    handles.push(handle)
    expect(handle.port).toBeGreaterThan(0)
    expect((await handle.healthCheck()).ok).toBe(true)
    const storageHealth = await fetch(`http://127.0.0.1:${handle.port}/api/health/storage`).then((response) => response.json()) as any
    expect(storageHealth.data).toEqual({ ok: true, status: 'healthy', warnings: [] })
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
      async healthCheck() { return { ok: true as const, status: 'healthy' as const, warnings: [] } },
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

  it('dual-writes conversation logs and serves the real session file route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-conversation-diagnostics-'))
    const writer = new RuntimeDiagnosticsWriter(root)
    const { buildApp } = await import('../app')
    const { logRoutes } = await import('../routes/logs')
    const app = await buildApp({ storage: { ...fakeStorage(root), diagnosticsWriter: writer }, registerRoutes: false })
    await app.register(logRoutes)
    handles.push(app)
    const entry = {
      level: 'info', type: 'system', source: 'server', message: 'conversation-owned',
      metadata: { conversationId: 'conversation-42' },
    }
    expect((await app.inject({ method: 'POST', url: '/api/logs', payload: { logs: [entry] } })).statusCode).toBe(200)
    const response = await app.inject({ method: 'GET', url: '/api/logs/file?conversationId=conversation-42' })
    expect(response.statusCode).toBe(200)
    expect(response.json().entries).toEqual([expect.objectContaining({ message: 'conversation-owned' })])
    expect(readFileSync(join(root, 'system.log'), 'utf8')).toContain('conversation-owned')
    expect(readFileSync(join(root, 'conversations', 'conversation-42', 'log.ndjson'), 'utf8')).toContain('conversation-owned')
  })

  it('rejects unsafe conversation ids without escaping the diagnostics root', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-safe-diagnostics-'))
    const writer = new RuntimeDiagnosticsWriter(root)
    expect(writer.getSessionLogFilePath('../escape')).toBe('')
    expect(writer.append({ id: 'unsafe', timestamp: new Date().toISOString(), metadata: { conversationId: '../escape' } })).toBe(true)
    expect(existsSync(join(root, 'conversations'))).toBe(false)
    expect(readFileSync(join(root, 'system.log'), 'utf8')).toContain('unsafe')
  })

  it('contains persistent I/O failures and reports append failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-failed-diagnostics-'))
    writeFileSync(join(root, 'system.log'), 'blocks-directory', 'utf8')
    const writer = new RuntimeDiagnosticsWriter(join(root, 'system.log'))
    expect(() => writer.append({ id: 'does-not-crash-business', timestamp: new Date().toISOString() })).not.toThrow()
    expect(writer.append({ id: 'failed', timestamp: new Date().toISOString() })).toBe(false)
    writer.quiesce()
    expect(writer.append({ id: 'buffered', timestamp: new Date().toISOString() })).toBe(true)
    expect(() => writer.reopen(join(root, 'system.log'))).not.toThrow()
  })

  it('crosses the terminal dispose barrier even when buffered flush fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-terminal-diagnostics-'))
    const blockedRoot = join(root, 'not-a-directory')
    writeFileSync(blockedRoot, 'blocked', 'utf8')
    const writer = new RuntimeDiagnosticsWriter(blockedRoot)
    writer.quiesce()
    expect(writer.append({ id: 'will-be-dropped', timestamp: new Date().toISOString() })).toBe(true)
    expect(() => writer.dispose()).not.toThrow()
    expect(writer.append({ id: 'late', timestamp: new Date().toISOString() })).toBe(false)
    expect(() => writer.reopen(root)).toThrow(/disposed/i)
    expect(() => writer.dispose()).not.toThrow()
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

  it('waits for a gated marketplace refresh before startup failure cleanup completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-gated-startup-'))
    let releaseRefresh!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const { createBackendStorageRuntime } = await import('./runtime')
    const { startServer } = await import('../server')
    const runtime = createBackendStorageRuntime(fakeStorage(root), { marketplaceRefresh: async () => {
      markStarted(); await gate
      logFileWriter.appendToFile({ id: 'refresh-finished', timestamp: new Date().toISOString() })
      return { sourceUrl: 'test', refreshedAt: new Date().toISOString(), items: [] } as any
    } })
    let settled = false
    const startup = startServer({
      storage: runtime, port: 0, registerRoutes: false,
      startup: { cleanupStaleRag() { throw new Error('startup rejected') }, initializeSkills() {} },
    }).finally(() => { settled = true })
    await started; await Promise.resolve()
    expect(settled).toBe(false)
    releaseRefresh()
    await expect(startup).rejects.toThrow(/startup rejected/)
    expect(settled).toBe(true)
    const file = join(root, 'diagnostics', 'system.log')
    const content = readFileSync(file, 'utf8')
    await Promise.resolve()
    expect(readFileSync(file, 'utf8')).toBe(content)
    expect(() => runtime.marketplaceScheduler.acquire()).toThrow(/disposed/i)
    await expect(runtime.marketplaceScheduler.reopen(join(root, 'other'))).rejects.toThrow(/disposed/i)
    await runtime.marketplaceScheduler.dispose(); await runtime.marketplaceScheduler.dispose()
  })

  it('keeps marketplace success and failure logging inside the exact owner context', async () => {
    const roots = ['success', 'failure'].map((name) => mkdtempSync(join(tmpdir(), `manta-owner-log-${name}-`)))
    const writers = roots.map((root) => new RuntimeDiagnosticsWriter(root))
    const logFor = (index: number) => ({
      info: (message: string) => logFileWriter.appendToFile({ id: `info-${index}`, timestamp: new Date().toISOString(), message }),
      warn: (message: string) => logFileWriter.appendToFile({ id: `warn-${index}`, timestamp: new Date().toISOString(), message }),
    })
    const success = createClaudeMarketplaceRuntimeOwner('success-cache', async () => ({ sourceUrl: 'test', refreshedAt: new Date().toISOString(), items: [] }) as any, (op) => runWithDiagnosticsOwner(writers[0], op))
    const failure = createClaudeMarketplaceRuntimeOwner('failure-cache', async () => { throw new Error('expected refresh failure') }, (op) => runWithDiagnosticsOwner(writers[1], op))
    const releaseSuccess = success.acquire(logFor(0)); const resumeFailure = failure.pause(); const releaseFailure = failure.acquire(logFor(1))
    await success.checkpoint(); resumeFailure(); await failure.checkpoint()
    const successLog = readFileSync(join(roots[0], 'system.log'), 'utf8')
    const failureLog = readFileSync(join(roots[1], 'system.log'), 'utf8')
    expect(successLog).toContain('info-0'); expect(successLog).not.toContain('warn-1')
    expect(failureLog).toContain('warn-1'); expect(failureLog).toContain('expected refresh failure'); expect(failureLog).not.toContain('info-0')
    releaseSuccess(); releaseFailure(); await success.dispose(); await failure.dispose()
  })
})
