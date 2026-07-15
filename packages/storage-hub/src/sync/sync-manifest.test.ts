import { describe, expect, it } from 'vitest'
import { SyncManifestSchema, syncManifestPath } from './sync-manifest'

describe('sync manifest', () => {
  it('accepts only a credential-free consistent snapshot manifest', () => {
    expect(SyncManifestSchema.parse({ schemaVersion: 1, volumeId: 'v1', generation: 2, groupHashes: { work: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' })).toMatchObject({ volumeId: 'v1' })
    expect(() => SyncManifestSchema.parse({ schemaVersion: 1, volumeId: 'v1', generation: 2, groupHashes: { secrets: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z', token: 'secret' })).toThrow()
    expect(() => SyncManifestSchema.parse({ schemaVersion: 1, volumeId: 'v1', generation: 2, groupHashes: { invented: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' })).toThrow(/unsupported/i)
    expect(syncManifestPath('/cache')).toMatch(/ash-sync-manifest\.json$/)
  })
})
