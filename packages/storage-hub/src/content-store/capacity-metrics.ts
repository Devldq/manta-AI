import { lstat, readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { StorageCapacityBlocker, StorageVolumeCapacityMetrics } from '@manta/shared'
import { scanVolumeReferences, type PendingContentReferences, type VerifiedContentObject } from './reference-scan'

export interface CapacityAllocationEvidence { allocatedBytes: number | null; evidence: string }
export interface VolumeCapacityOptions {
  volumeId: string
  pending: () => Promise<PendingContentReferences & { complete: true }> | (PendingContentReferences & { complete: true })
  allocation?: (object: VerifiedContentObject) => CapacityAllocationEvidence
}

function add(total: number, value: number): number {
  const next = total + value
  if (!Number.isSafeInteger(next)) throw new Error('Capacity byte total exceeds the safe integer range')
  return next
}

async function replicaBytes(volumeRoot: string): Promise<{ bytes: number; blockers: StorageCapacityBlocker[] }> {
  const root = resolve(volumeRoot, '.ash', 'sync'); let bytes = 0; const blockers: StorageCapacityBlocker[] = []
  async function walk(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Replica trees must not contain links or junctions')
    if (stat.isFile()) { bytes = add(bytes, stat.size); return }
    if (!stat.isDirectory()) throw new Error('Replica entry is not an ordinary file or directory')
    for (const name of (await readdir(path)).sort()) await walk(resolve(path, name))
  }
  try { await walk(root) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') blockers.push({ code: 'replica-unreadable', path: relative(volumeRoot, root), detail: error instanceof Error ? error.message : String(error) })
  }
  return { bytes, blockers }
}

async function cleanableBytes(volumeRoot: string, objects: VerifiedContentObject[], allocation: (object: VerifiedContentObject) => CapacityAllocationEvidence): Promise<{ bytes: number | null; blockers: StorageCapacityBlocker[] }> {
  const root = resolve(volumeRoot, '.ash', 'gc', 'quarantine'); const blockers: StorageCapacityBlocker[] = []; let bytes = 0
  try {
    const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Quarantine root must be an ordinary directory')
    const byHash = new Map(objects.map((object) => [object.hash, object]))
    for (const name of (await readdir(root)).sort()) {
      const path = resolve(root, name); const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`Invalid quarantine entry ${name}`)
      const candidate: unknown = JSON.parse(await readFile(path, 'utf8')); const hash = name.slice(0, -5); const record = candidate as Record<string, unknown>; const object = byHash.get(hash)
      if (!object || record.schemaVersion !== 1 || record.hash !== hash || record.size !== object.size || record.identity !== object.identity || record.mtimeMs !== object.mtimeMs || object.links !== 1) throw new Error(`Quarantine candidate ${name} is not unchanged`)
      const observed = allocation(object)
      if (observed.allocatedBytes === null || observed.evidence === 'unavailable' || !Number.isSafeInteger(observed.allocatedBytes) || observed.allocatedBytes < 0) throw new Error(`Allocation unavailable for ${hash}`)
      bytes = add(bytes, observed.allocatedBytes)
    }
    return { bytes, blockers }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, blockers }
    blockers.push({ code: 'cleanable-unverified', path: relative(volumeRoot, root), detail: error instanceof Error ? error.message : String(error) })
    return { bytes: null, blockers }
  }
}

export async function measureVolumeCapacity(volumeRoot: string, options: VolumeCapacityOptions): Promise<StorageVolumeCapacityMetrics> {
  if (!options || typeof options.pending !== 'function') throw new Error('A mandatory pending-operation inspector is required')
  let pending: PendingContentReferences & { complete: true }
  try { pending = await options.pending() } catch (error) {
    return { volumeId: options.volumeId, scanStatus: 'degraded', logicalImmutableBytes: 0, physicalImmutableBytes: null, verifiedDedupSavedBytes: null, replicaBytes: 0, cleanableBytes: null, scannedAt: new Date().toISOString(), blockers: [{ code: 'pending-operation', detail: error instanceof Error ? error.message : String(error) }] }
  }
  const scan = await scanVolumeReferences(volumeRoot, pending); const replicas = await replicaBytes(volumeRoot)
  const allocation = options.allocation ?? ((object) => ({ allocatedBytes: object.allocatedBytes, evidence: object.allocationEvidence }))
  const blockers: StorageCapacityBlocker[] = [...scan.blockers, ...replicas.blockers]
  let physical = 0
  for (const object of scan.objects) {
    const observed = allocation(object)
    if (observed.allocatedBytes === null || observed.evidence === 'unavailable' || !Number.isSafeInteger(observed.allocatedBytes) || observed.allocatedBytes < 0) { blockers.push({ code: 'allocation-unavailable', path: relative(volumeRoot, object.path), detail: 'Verified allocation evidence is unavailable' }); physical = -1; break }
    try { physical = add(physical, observed.allocatedBytes) } catch (error) { blockers.push({ code: 'allocation-unavailable', detail: (error as Error).message }); physical = -1; break }
  }
  const cleanable = await cleanableBytes(volumeRoot, scan.objects, allocation); blockers.push(...cleanable.blockers)
  const complete = scan.complete && replicas.blockers.length === 0 && cleanable.blockers.length === 0 && physical >= 0
  return { volumeId: options.volumeId, scanStatus: complete ? 'complete' : 'degraded', logicalImmutableBytes: scan.logicalImmutableBytes, physicalImmutableBytes: complete ? physical : null, verifiedDedupSavedBytes: complete ? Math.max(0, scan.logicalImmutableBytes - physical) : null, replicaBytes: replicas.bytes, cleanableBytes: cleanable.bytes, scannedAt: scan.scannedAt, blockers }
}
