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

  it('relaunches only after a committed healthy migration', async () => {
    const { controller, deps } = harness(bootstrap)
    await controller.start()
    const operation = vi.fn(async () => 'op-1')
    await controller.migrateAndRelaunch(operation)
    expect(operation).toHaveBeenCalled()
    expect(deps.relaunch.mock.invocationCallOrder[0]).toBeGreaterThan(operation.mock.invocationCallOrder[0])
    expect(deps.quit).toHaveBeenCalled()
  })

  it('restores the previous mapping before relaunch when new-location health verification fails', async () => {
    const { controller, deps, server } = harness(bootstrap)
    await controller.start()
    server.healthCheck.mockResolvedValueOnce({ ok: false, error: 'bad target' })
    const rollback = vi.fn(async () => {})
    await expect(controller.migrateAndRelaunch(async () => 'op', rollback)).rejects.toThrow('bad target')
    expect(rollback).toHaveBeenCalled()
    expect(deps.relaunch.mock.invocationCallOrder[0]).toBeGreaterThan(rollback.mock.invocationCallOrder[0])
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
})
