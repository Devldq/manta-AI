import { describe, expect, it, vi } from 'vitest'
import { createCloudSyncRuntime } from './createCloudSyncRuntime'

describe('createCloudSyncRuntime', () => {
  it('polls health before startup sync, blocks unhealthy volumes, and serializes a manual request through the same scheduler', async () => {
    const sync = vi.fn(async () => {})
    const runtime = createCloudSyncRuntime({
      volumes: async () => [{ volumeId: 'cloud', root: '/icloud/.manta-ai' }, { volumeId: 'local', root: '/local/.manta-ai' }],
      inspect: async (root) => ({ root, status: root.includes('icloud') ? 'unreadable' as const : 'healthy' as const, conflicts: [], checkedAt: '2026-07-13T00:00:00.000Z' }),
      sync,
      pollIntervalMs: 60_000,
      syncIntervalMs: 60_000,
    })

    await runtime.start()
    expect(sync).toHaveBeenCalledWith('local', 'startup')
    expect(sync).not.toHaveBeenCalledWith('cloud', 'startup')
    expect(runtime.health()).toMatchObject({ cloud: { status: 'unreadable' }, local: { status: 'healthy' } })

    await expect(runtime.syncNow('cloud')).resolves.toBeUndefined()
    expect(sync).not.toHaveBeenCalledWith('cloud', 'manual')
    await runtime.syncNow('local')
    expect(sync).toHaveBeenCalledWith('local', 'manual')
    runtime.dispose()
  })

  it('returns a real manual Git failure after retaining the health snapshot', async () => {
    const runtime = createCloudSyncRuntime({
      volumes: async () => [{ volumeId: 'one', root: '/one/.manta-ai' }],
      inspect: async (root) => ({ root, status: 'healthy', conflicts: [], checkedAt: '2026-07-13T00:00:00.000Z' }),
      sync: async () => { throw new Error('remote unavailable') },
      pollIntervalMs: 60_000,
      syncIntervalMs: 60_000,
    })
    await runtime.start()
    await expect(runtime.syncNow('one')).rejects.toThrow('remote unavailable')
    expect(runtime.health().one.status).toBe('healthy')
    runtime.dispose()
  })
})
