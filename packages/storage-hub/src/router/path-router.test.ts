import path from 'node:path'
import type { AshBootstrap } from '@manta/shared'
import { describe, expect, it } from 'vitest'
import { VolumeRegistry } from '../registry/volume-registry'
import { StoragePathRouter } from './path-router'

const bootstrap = (parentPath: string): AshBootstrap => ({ schemaVersion: 1, generation: 1, volumes: [{ id: 'v1', name: 'one', parentPath, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions: 'v1', knowledge: 'v1', work: 'v1', config: 'v1', secrets: 'v1', diagnostics: 'v1', cache: 'v1' } })

describe('StoragePathRouter', () => {
  it.each([['/parent', path.posix.join('/parent', '.manta-ai', 'work', 'a', 'b')], ['C:\\parent', path.win32.join('C:\\parent', '.manta-ai', 'work', 'a', 'b')], ['\\\\server\\share', path.win32.join('\\\\server\\share', '.manta-ai', 'work', 'a', 'b')]])('routes POSIX, drive, and UNC parents beneath the group root', (parent, expected) => expect(new StoragePathRouter(new VolumeRegistry(bootstrap(parent))).resolve('work', 'a', 'b')).toBe(expected))
  it.each([['..'], ['../escape'], ['/absolute'], ['C:\\absolute'], ['\\\\server\\share'], ['bad\0name']])('rejects unsafe segment %s', (segment) => expect(() => new StoragePathRouter(new VolumeRegistry(bootstrap('/parent'))).resolve('work', segment)).toThrow())
  it('rejects case-equivalent nested active volume roots', () => expect(() => new VolumeRegistry({ ...bootstrap('C:\\Data'), volumes: [...bootstrap('C:\\Data').volumes, { ...bootstrap('C:\\Data').volumes[0], id: 'v2', parentPath: 'c:\\data\\.MANTA-AI\\nested' }] })).toThrow())
  it('keeps source and target paths contained in their group root', () => {
    const router = new StoragePathRouter(new VolumeRegistry(bootstrap('/parent')))
    expect(router.resolve('work', 'source', 'file')).toMatch(/^\/parent\/\.manta-ai\/work\//)
    expect(router.resolve('work', 'target', 'file')).toMatch(/^\/parent\/\.manta-ai\/work\//)
  })
})
