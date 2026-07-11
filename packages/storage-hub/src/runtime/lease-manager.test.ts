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
})
