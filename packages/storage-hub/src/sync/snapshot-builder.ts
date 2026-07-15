import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { inventoryTree } from '../inventory/file-inventory'
import { SyncManifestSchema, syncManifestPath, type SyncManifest } from './sync-manifest'

export const SNAPSHOT_GROUPS = STORAGE_GROUP_IDS.filter((group) => !['secrets', 'diagnostics', 'cache'].includes(group)) as StorageGroupId[]
const transient = (relative: string) => /(^|\/)(?:\.ash|\.ash-staging|\.ash-backups)(?:\/|$)|(?:^|\/)[^/]*\.tmp$|(?:-wal|-shm)$/.test(relative)

async function directoryExists(path: string): Promise<boolean> { try { return (await lstat(path)).isDirectory() } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
async function copyPersistent(source: string, destination: string, prefix = ''): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const name of (await readdir(source)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name
    if (transient(relative)) continue
    const from = join(source, name); const to = join(destination, name); const stat = await lstat(from)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) await copyPersistent(from, to, relative)
    else if (stat.isFile()) await cp(from, to, { preserveTimestamps: true })
  }
}
async function groupHash(root: string): Promise<string> {
  const inventory = await inventoryTree(root); const digest = createHash('sha256')
  for (const entry of inventory.entries.filter((entry) => entry.kind === 'file').sort((left, right) => left.relativePath.localeCompare(right.relativePath))) digest.update(`${entry.relativePath}\0${entry.size}\0${entry.sha256}\n`)
  return digest.digest('hex')
}

export async function buildVolumeSnapshot(options: {
  volumeId: string
  generation: number
  volumeRoot: string
  cachePath: string
  leases: StorageLeaseManager
  checkpoint?: (group: StorageGroupId) => Promise<void>
  now?: () => Date
  includeSecrets?: boolean
}): Promise<SyncManifest> {
  const groups = options.includeSecrets ? [...SNAPSHOT_GROUPS, 'secrets' as const] : SNAPSHOT_GROUPS
  const lease = await options.leases.acquireExclusive(groups)
  try {
    if (!options.includeSecrets) await rm(join(options.cachePath, 'secrets'), { recursive: true, force: true })
    const groupHashes: Partial<Record<StorageGroupId, string>> = {}
    for (const group of groups) {
      const source = join(options.volumeRoot, group); const destination = join(options.cachePath, group)
      await rm(destination, { recursive: true, force: true })
      if (!await directoryExists(source)) continue
      await options.checkpoint?.(group)
      await copyPersistent(source, destination)
      groupHashes[group] = await groupHash(destination)
    }
    const manifest = SyncManifestSchema.parse({ schemaVersion: 1, volumeId: options.volumeId, generation: options.generation, groupHashes, createdAt: (options.now ?? (() => new Date()))().toISOString() }) as SyncManifest
    await mkdir(options.cachePath, { recursive: true })
    await writeFile(syncManifestPath(options.cachePath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return manifest
  } finally { lease.release() }
}
