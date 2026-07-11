import type { AshBootstrap } from '@manta/shared'
import { describe, expect, it } from 'vitest'
import { VolumeRegistry } from './volume-registry'

const base = (): AshBootstrap => ({ schemaVersion: 1, generation: 1, volumes: [{ id: 'v1', name: 'one', parentPath: '/one', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions: 'v1', knowledge: 'v1', work: 'v1', config: 'v1', secrets: 'v1', diagnostics: 'v1', cache: 'v1' } })

describe('VolumeRegistry', () => {
  it('rejects duplicate volume ids', () => expect(() => new VolumeRegistry({ ...base(), volumes: [...base().volumes, { ...base().volumes[0], parentPath: '/two' }] })).toThrow())
  it('rejects unassigned groups', () => expect(() => new VolumeRegistry({ ...base(), groupAssignments: { ...base().groupAssignments, work: 'missing' } })).toThrow())
  it('rejects assignments outside the seven storage groups', () => expect(() => new VolumeRegistry({ ...base(), groupAssignments: { ...base().groupAssignments, extra: 'v1' } } as AshBootstrap)).toThrow())
  it('maps each group from authoritative bootstrap assignments', () => expect(new VolumeRegistry(base()).volumeFor('work').id).toBe('v1'))
})
