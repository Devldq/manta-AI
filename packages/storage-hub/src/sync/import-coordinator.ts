import { createHash } from 'node:crypto'
import { readdir, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageGroupId } from '@manta/shared'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { SyncManifestSchema, type SyncManifest } from './sync-manifest'
import type { ImportChoice } from './conflict-planner'

const IMPORTABLE = new Set<StorageGroupId>(['config', 'work', 'knowledge', 'extensions'])

export async function hashSyncGroup(root: string): Promise<string> {
  const files: string[] = []
  async function visit(path: string, relative = ''): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name); const childRelative = relative ? `${relative}/${name}` : name; const stat = await lstat(child)
      if (stat.isDirectory()) await visit(child, childRelative)
      else if (stat.isFile()) files.push(`${childRelative}\0${stat.size}\0${createHash('sha256').update(await readFile(child)).digest('hex')}`)
    }
  }
  try { await visit(root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const digest = createHash('sha256')
  for (const entry of files.sort()) digest.update(`${entry}\n`)
  return digest.digest('hex')
}

export class ImportCoordinator {
  constructor(private readonly options: {
    leases: StorageLeaseManager
    resolveGroupRoot(group: StorageGroupId): string
    replaceGroup(group: StorageGroupId, source: string): Promise<void>
    restoreGroup?(group: StorageGroupId): Promise<void>
    hashGroup?(root: string): Promise<string>
  }) {}

  /** Applies only explicit remote decisions after the isolated snapshot is fully validated. */
  async apply(input: { volumeId: string; stagingRoot: string; manifest: SyncManifest; decisions: Partial<Record<StorageGroupId, ImportChoice>> }): Promise<void> {
    const manifest = SyncManifestSchema.parse(input.manifest) as SyncManifest
    if (manifest.volumeId !== input.volumeId) throw new Error('Fetched sync manifest does not belong to this volume')
    const selected = Object.entries(input.decisions).filter(([, choice]) => choice === 'keep-remote').map(([group]) => group as StorageGroupId)
    for (const group of selected) {
      if (!IMPORTABLE.has(group) || !manifest.groupHashes[group]) throw new Error(`Storage group ${group} cannot be imported from this snapshot`)
      const actual = await (this.options.hashGroup ?? hashSyncGroup)(join(input.stagingRoot, group))
      if (actual !== manifest.groupHashes[group]) throw new Error(`Remote ${group} hash validation failed`)
    }
    if (!selected.length) return
    const lease = await this.options.leases.acquireExclusive(selected)
    const applied: StorageGroupId[] = []
    try {
      for (const group of selected) { applied.push(group); await this.options.replaceGroup(group, join(input.stagingRoot, group)) }
    } catch (error) {
      if (this.options.restoreGroup) for (const group of applied.reverse()) await this.options.restoreGroup(group)
      throw error
    } finally { lease.release() }
  }
}
