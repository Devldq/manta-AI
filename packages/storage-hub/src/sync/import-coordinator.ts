import { createHash } from 'node:crypto'
import { readdir, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageGroupId } from '@manta/shared'
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
    resolveGroupRoot(group: StorageGroupId): string
    /** Replaces all selected groups as one rollback-capable live-data transaction. */
    replaceGroups(groups: Array<{ group: StorageGroupId; source: string }>, preflight: () => Promise<void>): Promise<void>
    hashGroup?(root: string): Promise<string>
  }) {}

  /** Applies only explicit remote decisions after the isolated snapshot is fully validated. */
  async apply(input: { volumeId: string; stagingRoot: string; manifest: SyncManifest; decisions: Partial<Record<StorageGroupId, ImportChoice>>; expectedLocalHashes?: Partial<Record<StorageGroupId, string>> }): Promise<void> {
    const manifest = SyncManifestSchema.parse(input.manifest) as SyncManifest
    if (manifest.volumeId !== input.volumeId) throw new Error('Fetched sync manifest does not belong to this volume')
    const selected = Object.entries(input.decisions).filter(([, choice]) => choice === 'keep-remote').map(([group]) => group as StorageGroupId)
    for (const group of selected) {
      if (!IMPORTABLE.has(group) || !manifest.groupHashes[group]) throw new Error(`Storage group ${group} cannot be imported from this snapshot`)
      const actual = await (this.options.hashGroup ?? hashSyncGroup)(join(input.stagingRoot, group))
      if (actual !== manifest.groupHashes[group]) throw new Error(`Remote ${group} hash validation failed`)
    }
    if (!selected.length) return
    await this.options.replaceGroups(selected.map((group) => ({ group, source: join(input.stagingRoot, group) })), async () => {
      // MigrationCoordinator invokes this preflight while it owns the same
      // exclusive lease used for replacement, closing the plan/apply TOCTOU
      // window without recursively acquiring a non-reentrant lease.
      for (const group of selected) {
        const expected = input.expectedLocalHashes?.[group]
        if (expected !== undefined) {
          const actual = await (this.options.hashGroup ?? hashSyncGroup)(this.options.resolveGroupRoot(group))
          if (actual !== expected) throw new Error(`Local ${group} data changed after this import was planned; replan required`)
        }
      }
    })
  }
}
