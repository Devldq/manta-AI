import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('@manta/storage-hub package exports', () => {
  it('loads from CommonJS without requiring an ESM-only shared entry', () => {
    const hub = require('@manta/storage-hub') as typeof import('./index')
    expect(hub.volumeRoot('C:/Users/me')).toBe('C:\\Users\\me\\.manta-ai')
  })

  it('loads from ESM', async () => {
    const hub = await import('@manta/storage-hub') as typeof import('./index')
    expect(hub.volumeRoot('/Users/me')).toBe('/Users/me/.manta-ai')
  })
})
