import { describe, expect, it, vi } from 'vitest'
import { DesktopLifecycleController } from './DesktopLifecycleController'

const bootstrap = { schemaVersion: 1 as const, generation: 1, volumes: [], groupAssignments: {} as any }

function harness(value: unknown = undefined) {
  const calls: string[] = []
  const server = { port: 43125, healthCheck: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })), quiesce: vi.fn(), close: vi.fn() }
  const deps: any = {
    readBootstrap: vi.fn(async () => value), recover: vi.fn(async () => calls.push('recover')),
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

  it('recovers before composing storage and opens the actual server port', async () => {
    const { controller, calls } = harness(bootstrap)
    await controller.start()
    expect(calls).toEqual(['recover', 'server', 'http://127.0.0.1:43125'])
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
    const first = harness(bootstrap); first.deps.prepareRelaunch.mockImplementation(async (id: string) => { shared.intent = { operationId:id, attempt:0, phase:'awaiting-new-process-health' } })
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
    deps.readRelaunchIntent.mockResolvedValue({ operationId: 'op-health', phase: 'awaiting-new-process-health', attempt: 0 })
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
