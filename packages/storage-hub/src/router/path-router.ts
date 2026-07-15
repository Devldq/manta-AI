import { posix, win32 } from 'node:path'
import type { StorageGroupId } from '@manta/shared'
import { StorageInvariantError } from '../domain/errors'
import { isWindowsPath, volumeRoot } from '../domain/invariants'
import { VolumeRegistry } from '../registry/volume-registry'

function validateSegment(segment: string): void {
  if (segment.includes('\0') || posix.isAbsolute(segment) || win32.isAbsolute(segment)) throw new StorageInvariantError('Storage path segment must be relative')
  if (segment.split(/[\\/]+/).some((part) => part === '..')) throw new StorageInvariantError('Storage path traversal is not allowed')
}

export class StoragePathRouter {
  constructor(private readonly registry: VolumeRegistry) {}

  resolve(group: StorageGroupId, ...segments: string[]): string {
    segments.forEach(validateSegment)
    const volume = this.registry.volumeFor(group)
    const paths = isWindowsPath(volume.parentPath) ? win32 : posix
    const root = paths.join(volumeRoot(volume.parentPath), group)
    const resolved = paths.resolve(root, ...segments)
    const relative = paths.relative(root, resolved)
    if (relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) throw new StorageInvariantError('Storage path escapes its group root')
    return resolved
  }
}
