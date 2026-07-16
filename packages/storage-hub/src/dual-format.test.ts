import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStorageHub } from './runtime/storage-hub'

const require = createRequire(import.meta.url)

describe('@manta/storage-hub package exports', () => {
  it('loads from CommonJS without requiring an ESM-only shared entry', () => {
    const hub = require('@manta/storage-hub') as typeof import('./index')
    expect(hub.volumeRoot('C:/Users/me')).toBe('C:\\Users\\me\\manta-ai-data')
  })

  it('loads from ESM', async () => {
    const hub = await import('@manta/storage-hub') as typeof import('./index')
    expect(hub.volumeRoot('/Users/me')).toBe('/Users/me/manta-ai-data')
  })

  it('accepts a CommonJS BootstrapStore across the ESM runtime boundary', async () => {
    const commonJs = require('@manta/storage-hub') as typeof import('./index')
    const directory = await mkdtemp(join(tmpdir(), 'ash-dual-format-'))
    const store = new commonJs.BootstrapStore(join(directory, 'ash-bootstrap.json'))
    const now = '2026-07-16T00:00:00.000Z'; const volumeId = 'volume-1'
    await store.write({ schemaVersion: 1, generation: 1, volumes: [{ id: volumeId, name: 'Default', parentPath: directory, createdAt: now, updatedAt: now }], groupAssignments: Object.fromEntries(commonJs.STORAGE_GROUP_IDS.map((group) => [group, volumeId])) as never })

    const storage = await createStorageHub({ bootstrap: store })

    expect(storage.resolve('config', 'settings.json')).toBe(join(directory, 'manta-ai-data', 'config', 'settings.json'))
  })
})
