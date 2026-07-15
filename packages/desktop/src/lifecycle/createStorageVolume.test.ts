import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireMigrationFileLock, BootstrapStore } from '@manta/storage-hub'
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

  it('preserves both volumes when independent stores create them concurrently', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-first-')); const second = await mkdtemp(join(tmpdir(), 'ash-second-')); const third = await mkdtemp(join(tmpdir(), 'ash-third-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    const [secondId, thirdId] = await Promise.all([
      createStorageVolume({ parentPath: second, name: 'Second', bootstrap: new BootstrapStore(bootstrapPath) }),
      createStorageVolume({ parentPath: third, name: 'Third', bootstrap: new BootstrapStore(bootstrapPath) }),
    ])
    const bootstrap = await new BootstrapStore(bootstrapPath).read()
    expect(bootstrap?.generation).toBe(3)
    expect(bootstrap?.volumes.filter(({ id }) => id === secondId || id === thirdId)).toHaveLength(2)
  })

  it('does not create an orphan volume when a relocation owns the Bootstrap lock', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-first-')); const target = await mkdtemp(join(tmpdir(), 'ash-target-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    const relocation = await acquireMigrationFileLock(bootstrapPath)
    let failure: unknown
    try {
      await createStorageVolume({ parentPath: target, name: 'Rejected', bootstrap: new BootstrapStore(bootstrapPath, { lockTimeoutMs: 25, lockRetryDelayMs: 5 }) })
    } catch (error) { failure = error }
    finally { await relocation.release() }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/transaction lock/i)
    await expect(access(join(target, '.manta-ai'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
