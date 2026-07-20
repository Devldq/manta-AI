import { describe, expect, it } from 'vitest'
import type { AshBootstrap } from '@manta/shared'
import { validateBootstrap, volumeRoot } from './invariants'

const volume = (id: string, parentPath: string) => ({
  id,
  name: id,
  parentPath,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
})

describe('storage bootstrap invariants', () => {
  it('rejects duplicate active volume roots', () => {
    const bootstrap = {
      schemaVersion: 1,
      generation: 1,
      volumes: [volume('primary', 'C:/data'), volume('duplicate', 'C:/data')],
      groupAssignments: {
        extensions: 'primary',
        knowledge: 'primary',
        work: 'primary',
        config: 'primary',
        secrets: 'primary',
        diagnostics: 'primary',
        cache: 'primary',
      },
    } satisfies AshBootstrap

    expect(() => validateBootstrap(bootstrap)).toThrow('exactly one volume')
  })

  it('rejects a group assigned to a missing volume', () => {
    const bootstrap = {
      schemaVersion: 1,
      generation: 1,
      volumes: [volume('primary', 'C:/data')],
      groupAssignments: {
        extensions: 'missing',
        knowledge: 'primary',
        work: 'primary',
        config: 'primary',
        secrets: 'primary',
        diagnostics: 'primary',
        cache: 'primary',
      },
    } satisfies AshBootstrap

    expect(() => validateBootstrap(bootstrap)).toThrow('exactly one volume')
  })
})

describe('volumeRoot', () => {
  it('uses manta-ai-data below the selected Windows parent', () => {
    expect(volumeRoot('C:/Users/me')).toBe('C:\\Users\\me\\manta-ai-data')
  })

  it('uses manta-ai-data below the selected POSIX parent', () => {
    expect(volumeRoot('/Users/me')).toBe('/Users/me/manta-ai-data')
  })

  it('uses an exact directory from new volume records without appending a child name', () => {
    expect(volumeRoot({ parentPath: '/Users/me', rootPath: '/Volumes/Manta Archive' })).toBe('/Volumes/Manta Archive')
  })
})
