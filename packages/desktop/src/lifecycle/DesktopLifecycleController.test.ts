import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BootstrapStore, STORAGE_GROUP_IDS } from '@manta/storage-hub'
import { describe, expect, it, vi } from 'vitest'
import { DesktopLifecycleController } from './DesktopLifecycleController'
import { upgradeBootstrapVolumeDirectories } from './LegacyVolumeUpgrade'

const bootstrap = { schemaVersion: 1 as const, generation: 1, volumes: [], groupAssignments: {} as any }
const timestamp = '2026-01-01T00:00:00.000Z'

async function writeLegacyVolume(parentPath: string, volumeId: string, sentinel: string): Promise<void> {
  const legacyRoot = join(parentPath, '.manta-ai')
  await mkdir(legacyRoot, { recursive: true })
  for (const group of STORAGE_GROUP_IDS) await mkdir(join(legacyRoot, group))
  await mkdir(join(legacyRoot, '.ash-backups'))
  await writeFile(join(legacyRoot, 'ash-volume.json'), JSON.stringify({ schemaVersion: 1, volumeId, name: volumeId, state: 'active', groups: [...STORAGE_GROUP_IDS], generation: 1, createdAt: timestamp, updatedAt: timestamp }))
  await writeFile(join(legacyRoot, 'sentinel.txt'), sentinel)
}

function harness(value: unknown = undefined) {
  const calls: string[] = []
  const server = { port: 43125, healthCheck: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })), quiesce: vi.fn(), close: vi.fn() }
  const deps: any = {
    readBootstrap: vi.fn(async () => value), recover: vi.fn(async () => calls.push('recover')),
    preflightStorage: vi.fn(async () => calls.push('preflight')),
    composeStorage: vi.fn(async () => ({ runtime: {}, hub: { migrations: {} } })),
    startServer: vi.fn(async () => { calls.push('server'); return server }),
    openOnboarding: vi.fn(async () => calls.push('onboarding')),
    openMain: vi.fn(async (url: string) => calls.push(url)),
    readRelaunchIntent: vi.fn(async () => undefined), prepareRelaunch: vi.fn(), rollbackRelaunchIntent: vi.fn(), completeRelaunchOperation: vi.fn(), clearRelaunchIntent: vi.fn(), resetComposition: vi.fn(),
    quit: vi.fn(), relaunch: vi.fn(), seedRoot: 'C:/resources',
  }
  return { controller: new DesktopLifecycleController(deps), deps, calls, server }
}

describe('DesktopLifecycleController', () => {
  it('gates Backend and main window behind first-launch initialization', async () => {
    const { controller, deps, calls } = harness()
    await controller.start()
    expect(calls).toEqual(['onboarding'])
    expect(deps.composeStorage).not.toHaveBeenCalled()
    expect(deps.startServer).not.toHaveBeenCalled()
  })

  it('continues initialized startup in the same process with real lifecycle progress', async () => {
    const { controller, deps, calls } = harness()
    deps.readBootstrap.mockResolvedValueOnce(undefined).mockResolvedValue(bootstrap)
    const events: Array<{ step: string; state: string }> = []

    await expect(controller.start()).resolves.toEqual({ ok: true })
    await expect(controller.continueAfterOnboarding((event) => events.push(event))).resolves.toEqual({ ok: true })

    expect(calls).toEqual(['onboarding', 'preflight', 'recover', 'server', 'http://127.0.0.1:43125'])
    expect(events).toEqual([
      { step: 'initialize-services', state: 'active' },
      { step: 'initialize-services', state: 'complete' },
      { step: 'start-backend', state: 'active' },
      { step: 'start-backend', state: 'complete' },
      { step: 'open-main', state: 'active' },
      { step: 'open-main', state: 'complete' },
    ])
    expect(deps.relaunch).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('marks service initialization failed and never starts Backend', async () => {
    const { controller, deps } = harness(bootstrap)
    deps.recover.mockRejectedValueOnce(new Error('ASH recovery failed'))
    const events: Array<{ step: string; state: string }> = []

    await expect(controller.continueAfterOnboarding((event) => events.push(event))).resolves.toMatchObject({ ok: false })

    expect(events).toEqual([
      { step: 'initialize-services', state: 'active' },
      { step: 'initialize-services', state: 'failed' },
    ])
    expect(deps.startServer).not.toHaveBeenCalled()
    expect(deps.openMain).not.toHaveBeenCalled()
  })

  it('keeps the main window closed when Backend health verification fails', async () => {
    const { controller, deps, server } = harness(bootstrap)
    server.healthCheck.mockResolvedValueOnce({ ok: false, error: 'Backend unhealthy' })
    const events: Array<{ step: string; state: string }> = []

    await expect(controller.continueAfterOnboarding((event) => events.push(event))).resolves.toMatchObject({ ok: false })

    expect(events.at(-1)).toEqual({ step: 'start-backend', state: 'failed' })
    expect(events).not.toContainEqual({ step: 'open-main', state: 'active' })
    expect(deps.openMain).not.toHaveBeenCalled()
  })

  it('recovers before composing storage and opens the actual server port', async () => {
    const { controller, calls } = harness(bootstrap)
    await controller.start()
    expect(calls).toEqual(['preflight', 'recover', 'server', 'http://127.0.0.1:43125'])
  })

  it('preflights every configured parent before reading relaunch state or starting recovery', async () => {
    const first = { id: 'first', name: 'First', parentPath: '/volumes/first', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const second = { ...first, id: 'second', name: 'Second', parentPath: '/volumes/second' }
    const configured = { ...bootstrap, volumes: [first, second] }
    const { controller, deps, calls } = harness(configured)
    deps.readRelaunchIntent.mockImplementation(async () => { calls.push('intent'); return undefined })

    await controller.start()

    expect(deps.preflightStorage).toHaveBeenCalledWith(configured)
    expect(calls.slice(0, 3)).toEqual(['preflight', 'intent', 'recover'])
  })

  it('upgrades every existing Bootstrap volume before real recovery can read its files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lifecycle-preflight-'))
    const firstParent = join(root, 'first-parent')
    const secondParent = join(root, 'second-parent')
    const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const first = { id: 'first-volume', name: 'First', parentPath: firstParent, createdAt: timestamp, updatedAt: timestamp }
    const second = { id: 'second-volume', name: 'Second', parentPath: secondParent, createdAt: timestamp, updatedAt: timestamp }
    await writeLegacyVolume(firstParent, first.id, 'first-data')
    await writeLegacyVolume(secondParent, second.id, 'second-data')
    await new BootstrapStore(bootstrapPath).write({ schemaVersion: 1, generation: 1, volumes: [first, second], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((group) => [group, first.id])) as any })
    const { controller, deps } = harness()
    deps.readBootstrap.mockImplementation(() => new BootstrapStore(bootstrapPath).read())
    deps.preflightStorage.mockImplementation((...values: any[]) => upgradeBootstrapVolumeDirectories(...values))
    deps.recover.mockImplementation(async () => {
      await expect(readFile(join(firstParent, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('first-data')
      await expect(readFile(join(secondParent, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('second-data')
      await expect(stat(join(firstParent, '.manta-ai'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(join(secondParent, '.manta-ai'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    await expect(controller.start()).resolves.toEqual({ ok: true })

    expect(deps.recover).toHaveBeenCalledTimes(1)
  })

  it('fails a real existing-Bootstrap startup before intent or recovery when old and current roots conflict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lifecycle-conflict-'))
    const parentPath = join(root, 'volume-parent')
    const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const volume = { id: 'conflicting-volume', name: 'Conflict', parentPath, createdAt: timestamp, updatedAt: timestamp }
    await writeLegacyVolume(parentPath, volume.id, 'legacy-data')
    await mkdir(join(parentPath, 'manta-ai-data'))
    await writeFile(join(parentPath, 'manta-ai-data', 'sentinel.txt'), 'current-data')
    await new BootstrapStore(bootstrapPath).write({ schemaVersion: 1, generation: 1, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((group) => [group, volume.id])) as any })
    const { controller, deps } = harness()
    deps.readBootstrap.mockImplementation(() => new BootstrapStore(bootstrapPath).read())
    deps.preflightStorage.mockImplementation((...values: any[]) => upgradeBootstrapVolumeDirectories(...values))

    await expect(controller.start()).resolves.toMatchObject({ ok: false, error: { code: 'LEGACY_VOLUME_CONFLICT' } })

    expect(deps.readRelaunchIntent).not.toHaveBeenCalled()
    expect(deps.recover).not.toHaveBeenCalled()
    await expect(readFile(join(parentPath, '.manta-ai', 'sentinel.txt'), 'utf8')).resolves.toBe('legacy-data')
    await expect(readFile(join(parentPath, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('current-data')
  })

  it('preflights trusted relaunch snapshots before rollback performs volume I/O', async () => {
    const previous = { ...bootstrap, generation: 1 }
    const current = { ...bootstrap, generation: 2 }
    const intent = { schemaVersion: 1, operationId: 'op-preflight', phase: 'rolling-back', attempt: 0, previous, current, backupRefs: [] }
    const { controller, deps, calls } = harness(current)
    deps.readRelaunchIntent.mockResolvedValue(intent)
    deps.rollbackRelaunchIntent.mockImplementation(async () => { calls.push('rollback') })

    await controller.start()

    expect(deps.preflightStorage).toHaveBeenNthCalledWith(1, current)
    expect(deps.preflightStorage).toHaveBeenNthCalledWith(2, previous, current)
    expect(deps.rollbackRelaunchIntent.mock.invocationCallOrder[0]).toBeGreaterThan(deps.preflightStorage.mock.invocationCallOrder[1])
  })

  it('never enters relaunch rollback when snapshot preflight fails closed', async () => {
    const previous = { ...bootstrap, generation: 1 }
    const current = { ...bootstrap, generation: 2 }
    const intent = { schemaVersion: 1, operationId: 'op-conflict', phase: 'awaiting-new-process-health', attempt: 0, previous, current, backupRefs: [] }
    const { controller, deps } = harness(current)
    deps.readRelaunchIntent.mockResolvedValue(intent)
    deps.preflightStorage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('legacy roots conflict'), { code: 'LEGACY_VOLUME_CONFLICT' }))

    await expect(controller.start()).resolves.toMatchObject({ ok: false, error: { code: 'LEGACY_VOLUME_CONFLICT' } })

    expect(deps.rollbackRelaunchIntent).not.toHaveBeenCalled()
    expect(deps.recover).not.toHaveBeenCalled()
  })

  it('surfaces structured startup failure and supports retry', async () => {
    const { controller, deps } = harness(bootstrap)
    deps.startServer.mockRejectedValueOnce(Object.assign(new Error('disk offline'), { code: 'EIO' }))
    expect(await controller.start()).toEqual({ ok: false, error: { code: 'EIO', message: 'disk offline', retryable: true } })
    expect((await controller.retry()).ok).toBe(true)
  })

  it('closes a server that fails its startup health check before retry', async () => {
    const { controller, server } = harness(bootstrap)
    server.healthCheck.mockResolvedValueOnce({ ok: false, error: 'corrupt db' })
    expect((await controller.start()).ok).toBe(false)
    expect(server.close).toHaveBeenCalled()
  })

  it('disposes the recovered composition before retrying a failed startup', async () => {
    const { controller, deps, server } = harness(bootstrap)
    server.healthCheck.mockResolvedValueOnce({ ok: false, error: 'cloud volume unavailable' })

    expect((await controller.start()).ok).toBe(false)
    expect(deps.resetComposition).toHaveBeenCalledTimes(1)

    await expect(controller.retry()).resolves.toEqual({ ok: true })
    expect(deps.recover).toHaveBeenCalledTimes(2)
    expect(deps.resetComposition).toHaveBeenCalledTimes(1)
  })

  it('persists relaunch intent only after a committed migration', async () => {
    const { controller, deps } = harness(bootstrap)
    await controller.start()
    const operation = vi.fn(async () => 'op-1')
    await controller.migrateAndRelaunch(operation)
    expect(operation).toHaveBeenCalled()
    expect(deps.prepareRelaunch).toHaveBeenCalledWith('op-1')
    expect(deps.relaunch.mock.invocationCallOrder[0]).toBeGreaterThan(operation.mock.invocationCallOrder[0])
    expect(deps.quit).toHaveBeenCalled()
  })

  it('uses a real new controller instance to rollback failed new-process health and start the old location once', async () => {
    const shared: any = { intent: undefined, generation: 2, rolledBack: false }
    const first = harness(bootstrap); first.deps.prepareRelaunch.mockImplementation(async (id: string) => { shared.intent = { operationId:id, attempt:0, phase:'awaiting-new-process-health', previous:bootstrap, current:bootstrap, backupRefs:[] } })
    await first.controller.start(); await first.controller.migrateAndRelaunch(async () => 'op')
    expect(shared.intent.operationId).toBe('op')
    const second = harness(bootstrap); second.deps.readRelaunchIntent.mockImplementation(async () => shared.intent)
    second.deps.startServer.mockImplementationOnce(async () => ({ ...second.server, healthCheck: async () => ({ ok:false, error:'new native db failed' }) })).mockImplementationOnce(async () => second.server)
    second.deps.rollbackRelaunchIntent.mockImplementation(async () => { shared.rolledBack=true; shared.generation=1 })
    second.deps.clearRelaunchIntent.mockImplementation(async () => { shared.intent=undefined })
    expect((await second.controller.start()).ok).toBe(true)
    expect(shared.rolledBack).toBe(true); expect(shared.generation).toBe(1); expect(shared.intent).toBeUndefined()
    expect(second.deps.startServer).toHaveBeenCalledTimes(2)
  })

  it('marks a relaunching operation succeeded only after the new process is healthy', async () => {
    const { controller, deps } = harness(bootstrap)
    deps.readRelaunchIntent.mockResolvedValue({ operationId: 'op-health', phase: 'awaiting-new-process-health', attempt: 0, previous: bootstrap, current: bootstrap, backupRefs: [] })
    await expect(controller.start()).resolves.toEqual({ ok: true })
    expect(deps.completeRelaunchOperation).toHaveBeenCalledWith('op-health')
    expect(deps.clearRelaunchIntent.mock.invocationCallOrder[0]).toBeGreaterThan(deps.completeRelaunchOperation.mock.invocationCallOrder[0])
  })

  it('never relaunches an uncommitted migration', async () => {
    const { controller, deps } = harness(bootstrap); await controller.start()
    await expect(controller.migrateAndRelaunch(async () => { throw new Error('copy failed') })).rejects.toThrow('copy failed')
    expect(deps.relaunch).not.toHaveBeenCalled()
  })

  it('attempts every shutdown resource even when one fails', async () => {
    const { controller, server } = harness(bootstrap)
    await controller.start()
    server.quiesce.mockRejectedValueOnce(new Error('q'))
    server.close.mockRejectedValueOnce(new Error('c'))
    await expect(controller.shutdown()).rejects.toBeInstanceOf(AggregateError)
    expect(server.close).toHaveBeenCalled()
  })

  it('disposes the composition during normal shutdown after the server closes', async () => {
    const { controller, deps, server } = harness(bootstrap)
    await controller.start()

    await controller.shutdown()

    expect(server.close).toHaveBeenCalled()
    expect(deps.resetComposition).toHaveBeenCalledTimes(1)
    expect(deps.resetComposition.mock.invocationCallOrder[0]).toBeGreaterThan(server.close.mock.invocationCallOrder[0])
  })
})
