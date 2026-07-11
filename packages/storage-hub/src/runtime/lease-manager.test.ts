import { describe, expect, it } from 'vitest'
import { StorageLeaseManager } from './lease-manager'

describe('StorageLeaseManager', () => {
  it('does not let a later reader overtake a queued exclusive lease', async () => {
    const leases = new StorageLeaseManager()
    const first = await leases.acquireRead('work')
    const order: string[] = []
    const exclusive = leases.acquireExclusive(['work']).then((lease) => { order.push('exclusive'); return lease })
    const reader = leases.acquireRead('work').then((lease) => { order.push('reader'); return lease })
    first.release()
    const locked = await exclusive
    expect(order).toEqual(['exclusive'])
    locked.release()
    ;(await reader).release()
    expect(order).toEqual(['exclusive', 'reader'])
  })

  it('times out safely while an active writer is draining', async () => {
    const leases = new StorageLeaseManager()
    const writer = await leases.acquireWrite('work')
    await expect(leases.acquireExclusive(['work'], { timeoutMs: 5 })).rejects.toThrow(/timed out/i)
    writer.release()
    const next = await leases.acquireWrite('work')
    next.release()
  })

  it('allows unrelated groups to progress and release is idempotent', async () => {
    const leases = new StorageLeaseManager(); const work = await leases.acquireExclusive(['work']); const config = await leases.acquireWrite('config'); config.release(); config.release(); work.release(); work.release()
    const next = await leases.acquireExclusive(['work', 'config']); next.release()
  })

  it('lets active reads coexist with a writer but queues a second writer fairly', async () => {
    const leases = new StorageLeaseManager(); const read = await leases.acquireRead('work'); const first = await leases.acquireWrite('work'); let secondAcquired = false; const second = leases.acquireWrite('work').then((lease) => { secondAcquired = true; return lease })
    read.release(); await Promise.resolve(); expect(secondAcquired).toBe(false); first.release(); (await second).release()
  })
})
