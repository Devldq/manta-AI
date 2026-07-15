import { readdir, lstat, open } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { resolve, relative } from 'node:path'
import { AssetManifestStore } from './manifest-store'
import { assertContentHash, hashFileHandleSha256 } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'
import { posixAllocatedBytes } from '../inventory/file-inventory'

export type ReferenceScanBlockerCode = 'manifest-invalid' | 'manifest-unreadable' | 'object-tree-unreadable' | 'object-integrity' | 'pending-operation' | (string & {})
export interface ReferenceScanBlocker { code: ReferenceScanBlockerCode; path?: string; detail: string }
export interface PendingContentReferences { liveHashes?: Iterable<string>; blockers?: ReferenceScanBlocker[] }
export interface VerifiedContentObject { hash: string; path: string; size: number; mtimeMs: number; allocatedBytes: number | null; allocationEvidence: 'posix-blocks' | 'unavailable'; identity: string; links: number }
export interface VolumeReferenceScan {
  volumeRoot: string; complete: boolean; logicalImmutableBytes: number | null; liveHashes: Set<string>; objects: VerifiedContentObject[]; blockers: ReferenceScanBlocker[]; scannedAt: string
}

export function sumLogicalReferenceBytes(values: Iterable<number>): { bytes: number | null; overflow: boolean } {
  let bytes = 0
  for (const value of values) { const next = bytes + value; if (!Number.isSafeInteger(next)) return { bytes: null, overflow: true }; bytes = next }
  return { bytes, overflow: false }
}

/** Narrow deterministic race injection for stable-object regression tests only. */
export interface StableObjectReadTestHook { afterHandleHashBeforeCanonicalPathValidation?: (path: string) => void | Promise<void> }

function blocker(code: ReferenceScanBlockerCode, path: string | undefined, error: unknown): ReferenceScanBlocker {
  return { code, ...(path ? { path } : {}), detail: error instanceof Error ? error.message : String(error) }
}

const sameObjectStat = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs && left.size === right.size && left.mtimeMs === right.mtimeMs && left.nlink === right.nlink

async function readVerifiedContentObject(path: string, expectedHash: string, testHook: StableObjectReadTestHook = {}): Promise<VerifiedContentObject> {
  const handle = await open(path, 'r')
  try {
    const before = await handle.stat(); const digest = await hashFileHandleSha256(handle); const after = await handle.stat()
    await testHook.afterHandleHashBeforeCanonicalPathValidation?.(path)
    const canonical = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || !after.isFile() || after.isSymbolicLink() || !canonical.isFile() || canonical.isSymbolicLink() || !sameObjectStat(before, after) || !sameObjectStat(after, canonical) || digest.hash !== expectedHash || digest.size !== before.size) throw new Error('CAS object identity changed or failed stable hash verification')
    const blocks = posixAllocatedBytes(before.blocks) ?? null
    return { hash: expectedHash, path, size: before.size, mtimeMs: before.mtimeMs, allocatedBytes: process.platform === 'win32' ? null : blocks, allocationEvidence: process.platform === 'win32' || blocks === null ? 'unavailable' : 'posix-blocks', identity: `${before.dev}:${before.ino}:${before.birthtimeMs}`, links: before.nlink }
  } finally { await handle.close() }
}

async function scanUnlocked(volumeRoot: string, pending: PendingContentReferences = {}, testHook: StableObjectReadTestHook = {}): Promise<VolumeReferenceScan> {
  const root = resolve(volumeRoot); const blockers: ReferenceScanBlocker[] = []; const liveHashes = new Set<string>(); let logicalImmutableBytes: number | null = 0
  for (const hash of pending.liveHashes ?? []) { try { assertContentHash(hash); liveHashes.add(hash) } catch (error) { blockers.push(blocker('pending-operation', undefined, error)) } }
  for (const item of pending.blockers ?? []) blockers.push({ ...item })

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
      for (const entry of manifest.entries) {
        if (logicalImmutableBytes !== null) { const total = sumLogicalReferenceBytes([logicalImmutableBytes, entry.size]); logicalImmutableBytes = total.bytes; if (total.overflow) blockers.push(blocker('manifest-invalid', relative(root, path), new Error('Logical immutable byte total overflowed the safe integer range'))) }
        liveHashes.add(entry.hash)
      }
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
          objects.push(await readVerifiedContentObject(path, hash, testHook))
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
/** Pure read-only scan for optimistic measurement; callers must prove stability. */
export const scanVolumeReferencesReadOnly = scanUnlocked
