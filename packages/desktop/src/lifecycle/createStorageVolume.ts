import { randomUUID } from 'node:crypto'
import { access, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BootstrapStore, VolumeRegistry, writeJsonAtomic } from '@manta/storage-hub'
import type { StorageVolumeRecord } from '@manta/shared'
import {
  normalizeStorageParent,
  StorageInitializationError,
  type StorageValidationHooks,
  validateStorageParentForCreation,
} from './initializeStorage'
import { withPreparedVolumeRoot } from './LegacyVolumeUpgrade'

export async function createStorageVolume(options: { parentPath: string; name: string; bootstrap: BootstrapStore; minimumFreeBytes?: number; validationHooks?: StorageValidationHooks }): Promise<string> {
  const parentPath = await normalizeStorageParent(options.parentPath)
  return withPreparedVolumeRoot(parentPath, async (root) => {
    try { await access(root); throw new StorageInitializationError('TARGET_EXISTS', `${root} already exists`) }
    catch (error) { if (error instanceof StorageInitializationError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await validateStorageParentForCreation(parentPath, options.minimumFreeBytes, options.validationHooks)
    const now = new Date().toISOString(); const volume: StorageVolumeRecord = { id: randomUUID(), name: options.name, parentPath, createdAt: now, updatedAt: now }
    let created = false
    try {
      await options.bootstrap.update(async (current) => {
        try { await access(root); throw new StorageInitializationError('TARGET_EXISTS', `${root} already exists`) } catch (error) { if (error instanceof StorageInitializationError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        await mkdir(root); created = true
        await mkdir(join(root, '.ash-backups')); await writeJsonAtomic(join(root, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: 'archived', groups: [], generation: current.generation + 1, createdAt: now, updatedAt: now })
        const next = { ...current, generation: current.generation + 1, volumes: [...current.volumes, volume] }; new VolumeRegistry(next); return next
      })
      return volume.id
    } catch (error) {
      const registered = await options.bootstrap.read().then((current) => current?.volumes.some(({ id }) => id === volume.id) ?? false, () => false)
      if (created && !registered) await rm(root, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  })
}
