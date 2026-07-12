import { describe, expect, it, vi } from 'vitest'
import { createKnowledgeDriver } from './group-drivers'

function resources(fail: Partial<Record<'providerCheckpoint' | 'cacheCheckpoint' | 'providerClose' | 'cacheClose' | 'providerReopen' | 'cacheReopen', boolean>> = {}) {
  const operation = (key: keyof typeof fail) => vi.fn(async () => { if (fail[key]) throw new Error(`${key} failed`) })
  const provider = {
    checkpoint: operation('providerCheckpoint'), close: operation('providerClose'), reopen: operation('providerReopen'),
  }
  const cache = {
    checkpoint: operation('cacheCheckpoint'), close: operation('cacheClose'), reopen: operation('cacheReopen'),
  }
  return { provider, cache, driver: createKnowledgeDriver(provider as any, cache as any) }
}

describe('knowledge group driver best-effort lifecycle', () => {
  for (const phase of ['checkpoint', 'close', 'reopen'] as const) {
    it(`attempts provider and cache during ${phase} and aggregates both failures`, async () => {
      const title = phase[0].toUpperCase() + phase.slice(1)
      const { provider, cache, driver } = resources({ [`provider${title}`]: true, [`cache${title}`]: true } as any)
      const call = phase === 'reopen' ? driver.reopen('next-root') : driver[phase]()
      const error = await call.catch((value) => value)
      expect(error).toBeInstanceOf(AggregateError)
      expect(error.message).toContain(`provider${title} failed`)
      expect(error.message).toContain(`cache${title} failed`)
      expect(provider[phase]).toHaveBeenCalledOnce()
      expect(cache[phase]).toHaveBeenCalledOnce()
    })
  }

  it('runs both integrity checks and both closes even when every candidate operation fails', async () => {
    const provider = { integrityCheck: vi.fn(async () => { throw new Error('provider integrity failed') }), close: vi.fn(async () => { throw new Error('provider close failed') }) }
    const cache = { integrityCheck: vi.fn(() => { throw new Error('cache integrity failed') }), close: vi.fn(() => { throw new Error('cache close failed') }) }
    const active = resources()
    const driver = createKnowledgeDriver(active.provider as any, active.cache as any, { provider: () => provider as any, cache: () => cache as any })
    const result = await driver.validate('candidate')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/provider integrity failed.*cache integrity failed.*provider close failed.*cache close failed/)
    expect(provider.integrityCheck).toHaveBeenCalledOnce(); expect(cache.integrityCheck).toHaveBeenCalledOnce()
    expect(provider.close).toHaveBeenCalledOnce(); expect(cache.close).toHaveBeenCalledOnce()
  })
})
