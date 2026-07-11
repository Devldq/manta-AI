import { posix, win32 } from 'node:path'
import {
  ASH_VOLUME_DIR_NAME,
  AshBootstrapSchema,
  STORAGE_GROUP_IDS,
} from '@manta/shared'
import type { AshBootstrap } from '@manta/shared'
import { StorageInvariantError } from './errors'

export function volumeRoot(parentPath: string): string {
  return /^[A-Za-z]:[\\/]/.test(parentPath)
    ? win32.join(parentPath, ASH_VOLUME_DIR_NAME)
    : posix.join(parentPath, ASH_VOLUME_DIR_NAME)
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
    const root = volumeRoot(volume.parentPath).toLowerCase()
    if (volumeIds.has(volume.id) || roots.has(root)) {
      throw new StorageInvariantError('Each storage group must resolve to exactly one volume')
    }
    volumeIds.add(volume.id)
    roots.add(root)
  }

  for (const group of STORAGE_GROUP_IDS) {
    if (!volumeIds.has(bootstrap.groupAssignments[group])) {
      throw new StorageInvariantError(`Storage group ${group} must belong to exactly one volume`)
    }
  }

  return bootstrap
}
