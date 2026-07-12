import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore } from '@manta/storage-hub'
import { initializeStorage } from './initializeStorage'
import { createStorageVolume } from './createStorageVolume'

describe('createStorageVolume', () => {
  it('atomically registers a non-nested archived volume without exposing a renderer path', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-first-')); const second = await mkdtemp(join(tmpdir(), 'ash-second-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    const id = await createStorageVolume({ parentPath: second, name: 'Knowledge', bootstrap: new BootstrapStore(bootstrapPath) })
    expect((await new BootstrapStore(bootstrapPath).read())?.volumes.some((item) => item.id === id)).toBe(true)
    expect(JSON.parse(await readFile(join(second, '.manta-ai', 'ash-volume.json'), 'utf8')).state).toBe('archived')
  })
})
