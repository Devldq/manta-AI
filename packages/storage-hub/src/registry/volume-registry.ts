import type { AshBootstrap, StorageGroupId, StorageVolumeRecord } from '@manta/shared'
import { validateBootstrap, volumeRoot } from '../domain/invariants'
import { StorageInvariantError } from '../domain/errors'

function canonical(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

export class VolumeRegistry {
  readonly bootstrap: AshBootstrap
  private readonly byId: Map<string, StorageVolumeRecord>

  constructor(bootstrap: AshBootstrap) {
    this.bootstrap = validateBootstrap(bootstrap)
    const roots = this.bootstrap.volumes.map((volume) => canonical(volumeRoot(volume.parentPath)))
    for (let left = 0; left < roots.length; left += 1) {
      for (let right = left + 1; right < roots.length; right += 1) {
        if (contains(roots[left], roots[right]) || contains(roots[right], roots[left])) {
          throw new StorageInvariantError('Active volume roots must not be nested')
        }
      }
    }
    this.byId = new Map(this.bootstrap.volumes.map((volume) => [volume.id, volume]))
  }

  volumeFor(group: StorageGroupId): StorageVolumeRecord {
    const volume = this.byId.get(this.bootstrap.groupAssignments[group])
    if (!volume) throw new StorageInvariantError(`Storage group ${group} is not assigned`)
    return volume
  }
}
