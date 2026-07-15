import { describe, expect, it } from 'vitest'
import { AdapterRegistry } from './adapter-registry'
import type { AgentAdapter } from './types'

function adapter(id: string, displayName = id): AgentAdapter {
  return {
    id,
    displayName,
    detect: async () => [],
    inspect: async () => ({ schemaVersion: 1, installationId: 'target', assets: [] }),
    planImport: async () => { throw new Error('unused') },
    planProjection: async () => { throw new Error('unused') },
    apply: async () => { throw new Error('unused') },
  }
}

describe('AdapterRegistry', () => {
  it('rejects duplicate adapter ids', () => {
    const registry = new AdapterRegistry([adapter('safe-id')])
    expect(() => registry.register(adapter('safe-id', 'duplicate'))).toThrow(/duplicate/i)
  })

  it.each(['../escape', 'UPPER', 'two words', '', '.hidden', 'a/b', 'a\\b', 'nul\0id'])(
    'rejects the unsafe adapter id %j',
    (id) => expect(() => new AdapterRegistry([adapter(id)])).toThrow(/unsafe/i),
  )

  it('resolves and lists adapters deterministically without exposing registry mutation', () => {
    const registry = new AdapterRegistry([adapter('zeta'), adapter('alpha')])
    expect(registry.list().map(({ id }) => id)).toEqual(['alpha', 'zeta'])
    expect(registry.require('alpha').id).toBe('alpha')
    expect(() => registry.require('missing')).toThrow(/unknown/i)
    expect(() => (registry.list() as AgentAdapter[]).push(adapter('later'))).toThrow()
    expect(registry.list().map(({ id }) => id)).toEqual(['alpha', 'zeta'])
  })

  it('uses locale-independent code-unit ordering', () => {
    const original = String.prototype.localeCompare
    String.prototype.localeCompare = () => { throw new Error('locale-dependent ordering used') }
    try { expect(new AdapterRegistry([adapter('zeta'), adapter('alpha')]).list().map(({ id }) => id)).toEqual(['alpha', 'zeta']) } finally { String.prototype.localeCompare = original }
  })
})
