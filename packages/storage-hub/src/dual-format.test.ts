import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('@manta/storage-hub package exports', () => {
  it('loads from CommonJS without requiring an ESM-only shared entry', () => {
    const hub = require('../dist/index.cjs') as typeof import('./index')
    expect(hub.volumeRoot('C:/Users/me')).toBe('C:\\Users\\me\\.manta-ai')
  })

  it('loads from ESM', async () => {
    const hub = await import('../dist/index.js') as typeof import('./index')
    expect(hub.volumeRoot('/Users/me')).toBe('/Users/me/.manta-ai')
  })
})
