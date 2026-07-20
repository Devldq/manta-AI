import type { AshBootstrap, StorageGroupId, StorageVolumeRecord } from '@manta/shared'
import { posix, win32 } from 'node:path'
import { comparableVolumeRoot, validateBootstrap } from '../domain/invariants'
import { StorageInvariantError } from '../domain/errors'

function contains(flavor: 'windows' | 'posix', parent: string, child: string): boolean {
  const paths = flavor === 'windows' ? win32 : posix
  const relative = paths.relative(parent, child)
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`))
}

export class VolumeRegistry {
  readonly bootstrap: AshBootstrap
  private readonly byId: Map<string, StorageVolumeRecord>

  constructor(bootstrap: AshBootstrap) {
    this.bootstrap = validateBootstrap(bootstrap)
    const roots = this.bootstrap.volumes.map((volume) => comparableVolumeRoot(volume))
    for (let left = 0; left < roots.length; left += 1) {
      for (let right = left + 1; right < roots.length; right += 1) {
        if (roots[left].flavor === roots[right].flavor
          && (contains(roots[left].flavor, roots[left].path, roots[right].path)
            || contains(roots[left].flavor, roots[right].path, roots[left].path))) {
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
