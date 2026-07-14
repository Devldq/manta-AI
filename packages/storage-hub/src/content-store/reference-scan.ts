import { readdir, lstat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { AssetManifestStore } from './manifest-store'
import { assertContentHash, hashFileSha256 } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'
import { posixAllocatedBytes } from '../inventory/file-inventory'

export type ReferenceScanBlockerCode = 'manifest-invalid' | 'manifest-unreadable' | 'object-tree-unreadable' | 'object-integrity' | 'pending-operation'
export interface ReferenceScanBlocker { code: ReferenceScanBlockerCode; path?: string; detail: string }
export interface PendingContentReferences { liveHashes?: Iterable<string>; blockers?: Array<{ code?: string; detail: string }> }
export interface VerifiedContentObject { hash: string; path: string; size: number; allocatedBytes: number | null; allocationEvidence: 'posix-blocks' | 'unavailable'; identity: string; links: number }
export interface VolumeReferenceScan {
  volumeRoot: string; complete: boolean; logicalImmutableBytes: number; liveHashes: Set<string>; objects: VerifiedContentObject[]; blockers: ReferenceScanBlocker[]; scannedAt: string
}

function blocker(code: ReferenceScanBlockerCode, path: string | undefined, error: unknown): ReferenceScanBlocker {
  return { code, ...(path ? { path } : {}), detail: error instanceof Error ? error.message : String(error) }
}

async function scanUnlocked(volumeRoot: string, pending: PendingContentReferences = {}): Promise<VolumeReferenceScan> {
  const root = resolve(volumeRoot); const blockers: ReferenceScanBlocker[] = []; const liveHashes = new Set<string>(); let logicalImmutableBytes = 0
  for (const hash of pending.liveHashes ?? []) { try { assertContentHash(hash); liveHashes.add(hash) } catch (error) { blockers.push(blocker('pending-operation', undefined, error)) } }
  for (const item of pending.blockers ?? []) blockers.push({ code: 'pending-operation', detail: `${item.code ? `${item.code}: ` : ''}${item.detail}` })

  const assetsRoot = resolve(root, '.ash', 'assets')
  let manifests: string[] = []
  try {
    const stat = await lstat(assetsRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Manifest root is not an ordinary directory')
    manifests = (await readdir(assetsRoot)).sort()
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') blockers.push(blocker('manifest-unreadable', relative(root, assetsRoot), error)) }
  for (const name of manifests) {
    const path = resolve(assetsRoot, name)
    try {
      if (!name.endsWith('.json')) throw new Error('Unexpected file in manifest directory')
      const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Manifest must be an ordinary file')
      const assetId = name.slice(0, -5)
      const manifest = await new AssetManifestStore(root).readUnderLease(assetId)
      for (const entry of manifest.entries) { logicalImmutableBytes += entry.size; liveHashes.add(entry.hash) }
    } catch (error) { blockers.push(blocker((error as NodeJS.ErrnoException).code ? 'manifest-unreadable' : 'manifest-invalid', relative(root, path), error)) }
  }

  const objects: VerifiedContentObject[] = []; const objectsRoot = resolve(root, '.ash', 'objects', 'sha256')
  try {
    const rootStat = await lstat(objectsRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Object root is not an ordinary directory')
    for (const prefix of (await readdir(objectsRoot)).sort()) {
      const prefixPath = resolve(objectsRoot, prefix); const prefixStat = await lstat(prefixPath)
      if (!/^[a-f0-9]{2}$/.test(prefix) || !prefixStat.isDirectory() || prefixStat.isSymbolicLink()) throw new Error(`Unsafe object prefix ${prefix}`)
      for (const hash of (await readdir(prefixPath)).sort()) {
        const path = resolve(prefixPath, hash)
        try {
          assertContentHash(hash); if (hash.slice(0, 2) !== prefix) throw new Error('Object hash is stored below the wrong prefix')
          const before = await lstat(path); if (!before.isFile() || before.isSymbolicLink()) throw new Error('CAS object must be an ordinary file')
          const digest = await hashFileSha256(path); const after = await lstat(path)
          if (digest.hash !== hash || digest.size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('CAS object failed stable hash and size verification')
          const blocks = posixAllocatedBytes(before.blocks) ?? null
          objects.push({ hash, path, size: before.size, allocatedBytes: process.platform === 'win32' ? null : blocks, allocationEvidence: process.platform === 'win32' || blocks === null ? 'unavailable' : 'posix-blocks', identity: `${before.dev}:${before.ino}:${before.birthtimeMs}`, links: before.nlink })
        } catch (error) { blockers.push(blocker('object-integrity', relative(root, path), error)) }
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') blockers.push(blocker('object-tree-unreadable', relative(root, objectsRoot), error)) }
  return { volumeRoot: root, complete: blockers.length === 0, logicalImmutableBytes, liveHashes, objects, blockers, scannedAt: new Date().toISOString() }
}

export function scanVolumeReferences(volumeRoot: string, pending?: PendingContentReferences): Promise<VolumeReferenceScan> {
  return withVolumeContentStoreLease(volumeRoot, () => scanUnlocked(volumeRoot, pending))
}

/** Only for callers already holding the volume content-store lease. */
export const scanVolumeReferencesUnderLease = scanUnlocked
