import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireMigrationFileLock, BootstrapStore, inventoryTree, MigrationCoordinator, STORAGE_GROUP_IDS, StorageLeaseManager, volumeRoot, type StorageGroupDriver } from '@manta/storage-hub'
import { initializeStorage } from './initializeStorage'
import { createStorageVolume } from './createStorageVolume'
import { upgradeBootstrapVolumeDirectories } from './LegacyVolumeUpgrade'

describe('createStorageVolume', () => {
  it('atomically registers a non-nested archived volume without exposing a renderer path', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-first-')); const second = await mkdtemp(join(tmpdir(), 'ash-second-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    const id = await createStorageVolume({ parentPath: second, name: 'Knowledge', bootstrap: new BootstrapStore(bootstrapPath) })
    expect((await new BootstrapStore(bootstrapPath).read())?.volumes.some((item) => item.id === id)).toBe(true)
    expect(JSON.parse(await readFile(join(second, 'manta-ai-data', 'ash-volume.json'), 'utf8')).state).toBe('archived')
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

  it('shares the parent/root lock with preflight so a create race cannot strand a legacy root', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-create-race-first-')); const target = await mkdtemp(join(tmpdir(), 'ash-create-race-target-')); const bootstrapPath = join(first, 'bootstrap.json')
    const initialized = await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    const legacyRoot = join(target, '.manta-ai'); await mkdir(legacyRoot)
    await writeFile(join(legacyRoot, 'ash-volume.json'), JSON.stringify({ schemaVersion: 1, volumeId: 'legacy-target', name: 'Legacy', state: 'archived', groups: [], generation: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
    await writeFile(join(legacyRoot, 'sentinel.txt'), 'legacy-data')
    const active = (await new BootstrapStore(bootstrapPath).read())!
    const targetBootstrap = { ...active, volumes: [...active.volumes, { ...initialized.volume, id: 'legacy-target', parentPath: target }] }

    const [creating, preflighting] = await Promise.allSettled([
      createStorageVolume({ parentPath: target, name: 'Racing create', bootstrap: new BootstrapStore(bootstrapPath) }),
      upgradeBootstrapVolumeDirectories(targetBootstrap),
    ])

    expect(creating.status).toBe('rejected')
    expect(preflighting.status).toBe('fulfilled')
    await expect(readFile(join(target, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('legacy-data')
    await expect(access(legacyRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('checks legacy/current conflict before running new-volume probe or free-space validation', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-create-order-first-')); const target = await mkdtemp(join(tmpdir(), 'ash-create-order-target-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    await mkdir(join(target, '.manta-ai')); await writeFile(join(target, '.manta-ai', 'ash-volume.json'), JSON.stringify({ schemaVersion: 1, volumeId: 'legacy', name: 'Legacy', state: 'archived', groups: [], generation: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })); await mkdir(join(target, 'manta-ai-data'))
    let probeCalled = false

    await expect(createStorageVolume({
      parentPath: target,
      name: 'Conflict',
      bootstrap: new BootstrapStore(bootstrapPath),
      minimumFreeBytes: Number.MAX_SAFE_INTEGER,
      validationHooks: { probe: async () => { probeCalled = true; throw new Error('probe must not run') } },
    })).rejects.toMatchObject({ code: 'LEGACY_VOLUME_CONFLICT' })

    expect(probeCalled).toBe(false)
  })

  it('runs the write probe only after preflight proves create will use a new root', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-create-probe-first-')); const target = await mkdtemp(join(tmpdir(), 'ash-create-probe-target-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    let probeCalled = false

    await expect(createStorageVolume({
      parentPath: target,
      name: 'Probe failure',
      bootstrap: new BootstrapStore(bootstrapPath),
      validationHooks: { probe: async () => { probeCalled = true; throw new Error('access denied') } },
    })).rejects.toMatchObject({ code: 'UNWRITABLE' })

    expect(probeCalled).toBe(true)
    await expect(access(join(target, 'manta-ai-data'))).rejects.toMatchObject({ code: 'ENOENT' })
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
    await expect(access(join(target, 'manta-ai-data'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a durably registered volume when update reports a post-commit failure', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-first-')); const target = await mkdtemp(join(tmpdir(), 'ash-target-')); const bootstrapPath = join(first, 'bootstrap.json')
    await initializeStorage({ parentPath: first, bootstrapPath, minimumFreeBytes: 1 })
    class PostCommitFailureStore extends BootstrapStore {
      override async update(updater: Parameters<BootstrapStore['update']>[0]): Promise<never> {
        await super.update(updater); throw new Error('simulated lock release failure after durable Bootstrap write')
      }
    }
    await expect(createStorageVolume({ parentPath: target, name: 'Committed', bootstrap: new PostCommitFailureStore(bootstrapPath) })).rejects.toThrow(/release failure/)
    const bootstrap = await new BootstrapStore(bootstrapPath).read()
    expect(bootstrap?.volumes.some(({ parentPath }) => parentPath === target)).toBe(true)
    await expect(readFile(join(volumeRoot(target), 'ash-volume.json'), 'utf8')).resolves.toContain('Committed')
  })

  it('serializes creation behind relocation and preserves both committed mappings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-relocate-create-')); const source = join(root, 'source'); const relocated = join(root, 'relocated'); const added = join(root, 'added'); const bootstrapPath = join(root, 'user-data', 'bootstrap.json')
    const initialized = await initializeStorage({ parentPath: source, bootstrapPath, minimumFreeBytes: 1 })
    const drivers = new Map(STORAGE_GROUP_IDS.map((id) => [id, { id, quiesce: async () => {}, checkpoint: async () => {}, close: async () => {}, validate: async () => ({ ok: true }), reopen: async () => {}, inventory: inventoryTree } satisfies StorageGroupDriver]))
    let pauseRelocation!: () => void; let resumeRelocation!: () => void
    const relocationPaused = new Promise<void>((resolve) => { pauseRelocation = resolve }); const relocationGate = new Promise<void>((resolve) => { resumeRelocation = resolve })
    const coordinator = new MigrationCoordinator({ store: new BootstrapStore(bootstrapPath), leases: new StorageLeaseManager(), drivers, availableBytes: async () => Number.MAX_SAFE_INTEGER, fault: async (point) => { if (point === 'before-bootstrap-commit') { pauseRelocation(); await relocationGate } } })
    const relocating = coordinator.relocateVolume(initialized.volume.id, relocated)
    await relocationPaused
    let creationSettled = false
    const creating = createStorageVolume({ parentPath: added, name: 'Added', bootstrap: new BootstrapStore(bootstrapPath) }).finally(() => { creationSettled = true })
    await new Promise((resolve) => setTimeout(resolve, 25)); const overlapped = creationSettled
    resumeRelocation(); const [, addedId] = await Promise.all([relocating, creating])
    const bootstrap = await new BootstrapStore(bootstrapPath).read()
    expect(overlapped).toBe(false)
    expect(bootstrap?.generation).toBe(3)
    expect(bootstrap?.volumes.find(({ id }) => id === initialized.volume.id)?.parentPath).toBe(relocated)
    expect(bootstrap?.volumes.find(({ id }) => id === addedId)?.parentPath).toBe(added)
    expect(bootstrap?.previous?.generation).toBe(2)
  })
})
