import Module from 'node:module'
import { describe, expect, it } from 'vitest'

const require = Module.createRequire(import.meta.url)

describe('@manta/shared package exports', () => {
  it('loads the public contract from CommonJS', () => {
    const shared = require('@manta/shared') as typeof import('./index')
    expect(shared.STORAGE_GROUP_IDS).toHaveLength(7)
  })

  it('loads the public contract from ESM', async () => {
    const shared = await import('@manta/shared') as typeof import('./index')
    expect(shared.STORAGE_GROUP_IDS).toHaveLength(7)
  })
})
