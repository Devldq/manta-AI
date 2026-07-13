import { describe, expect, it, vi } from 'vitest'
import { SyncScheduler } from './scheduler'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SyncScheduler', () => {
  it('serializes manual actions for one volume while allowing different volumes to sync concurrently', async () => {
    const first = deferred()
    const sync = vi.fn((volumeId: string) => volumeId === 'one' ? first.promise : Promise.resolve())
    const scheduler = new SyncScheduler({ volumes: () => ['one', 'two'], intervalMs: 60_000, health: async () => 'healthy', sync })

    const oneA = scheduler.schedule('one', 'manual')
    const oneB = scheduler.schedule('one', 'manual')
    await scheduler.schedule('two', 'manual')
    expect(sync).toHaveBeenCalledWith('one', 'manual')
    expect(sync).toHaveBeenCalledWith('two', 'manual')
    expect(sync).toHaveBeenCalledTimes(2)

    first.resolve()
    await Promise.all([oneA, oneB])
    expect(sync).toHaveBeenCalledTimes(3)
    scheduler.dispose()
  })

  it('runs startup and interval triggers, but skips unhealthy volumes without calling sync', async () => {
    vi.useFakeTimers()
    const sync = vi.fn(async () => {})
    const skipped = vi.fn()
    const scheduler = new SyncScheduler({ volumes: () => ['online', 'offline'], intervalMs: 1_000, health: async (volumeId) => volumeId === 'online' ? 'healthy' : 'offline', sync, onSkip: skipped })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sync).toHaveBeenCalledTimes(2)
    expect(skipped).toHaveBeenCalledWith('offline', 'startup', 'offline')
    expect(skipped).toHaveBeenCalledWith('offline', 'interval', 'offline')

    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sync).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('contains scheduled sync failures and reports them rather than leaking a rejection', async () => {
    vi.useFakeTimers()
    const error = new Error('network unavailable')
    const onError = vi.fn()
    const scheduler = new SyncScheduler({ volumes: () => ['one'], intervalMs: 1_000, health: async () => 'healthy', sync: async () => { throw error }, onError })

    await scheduler.start()
    expect(onError).toHaveBeenCalledWith('one', 'startup', error)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onError).toHaveBeenCalledWith('one', 'interval', error)
    scheduler.dispose()
    vi.useRealTimers()
  })

  it('reports a manual failure to its caller after recording it, so the settings button never claims success', async () => {
    const error = new Error('remote unavailable')
    const onError = vi.fn()
    const scheduler = new SyncScheduler({ volumes: () => ['one'], intervalMs: 60_000, health: async () => 'healthy', sync: async () => { throw error }, onError })

    await expect(scheduler.schedule('one', 'manual')).rejects.toThrow('remote unavailable')
    expect(onError).toHaveBeenCalledWith('one', 'manual', error)
    scheduler.dispose()
  })

  it('has one startup lifecycle even when start is called concurrently', async () => {
    const gate = deferred()
    const sync = vi.fn(async () => gate.promise)
    const scheduler = new SyncScheduler({ volumes: () => ['one'], intervalMs: 60_000, health: async () => 'healthy', sync })

    const first = scheduler.start()
    const second = scheduler.start()
    gate.resolve()
    await Promise.all([first, second])
    expect(sync).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })
})
