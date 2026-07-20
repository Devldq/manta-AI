import { posix, win32 } from 'node:path'
import {
  ASH_VOLUME_DIR_NAME,
  AshBootstrapSchema,
  STORAGE_GROUP_IDS,
} from '@manta/shared'
import type { AshBootstrap, StorageVolumeRecord } from '@manta/shared'
import { StorageInvariantError } from './errors'

type VolumeLocation = string | Pick<StorageVolumeRecord, 'parentPath' | 'rootPath'>

/**
 * Resolves both legacy parent-based volume records and new exact-directory
 * records. Passing a string intentionally keeps the legacy parent semantics so
 * pending migrations and existing callers remain backward compatible.
 */
export function volumeRoot(location: VolumeLocation): string {
  if (typeof location !== 'string' && location.rootPath) {
    return isWindowsPath(location.rootPath)
      ? win32.normalize(location.rootPath)
      : posix.normalize(location.rootPath)
  }
  const parentPath = typeof location === 'string' ? location : location.parentPath
  return isWindowsPath(parentPath)
    ? win32.join(parentPath, ASH_VOLUME_DIR_NAME)
    : posix.join(parentPath, ASH_VOLUME_DIR_NAME)
}

export function isWindowsPath(filePath: string): boolean {
  return win32.isAbsolute(filePath) && !posix.isAbsolute(filePath)
}

export function comparableVolumeRoot(location: VolumeLocation): { flavor: 'windows' | 'posix'; path: string } {
  const root = volumeRoot(location)
  if (isWindowsPath(root)) return { flavor: 'windows', path: win32.normalize(root).toLowerCase() }
  return { flavor: 'posix', path: posix.normalize(root) }
}

export function validateBootstrap(input: unknown): AshBootstrap {
  const rawAssignments = input && typeof input === 'object' && 'groupAssignments' in input
    ? (input as { groupAssignments?: unknown }).groupAssignments
    : undefined
  if (!rawAssignments || typeof rawAssignments !== 'object' || Array.isArray(rawAssignments)
    || Object.keys(rawAssignments).length !== STORAGE_GROUP_IDS.length
    || Object.keys(rawAssignments).some((group) => !STORAGE_GROUP_IDS.includes(group as (typeof STORAGE_GROUP_IDS)[number]))) {
    throw new StorageInvariantError('Bootstrap assignments must cover exactly the seven storage groups')
  }
  const bootstrap = AshBootstrapSchema.parse(input)
  const volumeIds = new Set<string>()
  const roots = new Set<string>()

  for (const volume of bootstrap.volumes) {
    const root = comparableVolumeRoot(volume)
    const rootKey = `${root.flavor}:${root.path}`
    if (volumeIds.has(volume.id) || roots.has(rootKey)) {
      throw new StorageInvariantError('Each storage group must resolve to exactly one volume')
    }
    volumeIds.add(volume.id)
    roots.add(rootKey)
  }

  for (const group of STORAGE_GROUP_IDS) {
    if (!volumeIds.has(bootstrap.groupAssignments[group])) {
      throw new StorageInvariantError(`Storage group ${group} must belong to exactly one volume`)
    }
  }

  return bootstrap
}
