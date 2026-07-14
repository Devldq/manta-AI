import { lstat, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { StorageCapacityBlocker, StorageVolumeCapacityMetrics } from '@manta/shared'
import { readGarbageCollectionCandidateStable, validateGarbageCandidateObject } from './garbage-candidate'
import { scanVolumeReferencesReadOnly, type PendingContentReferences, type VerifiedContentObject, type VolumeReferenceScan } from './reference-scan'

export interface CapacityAllocationEvidence { allocatedBytes: number | null; evidence: string }
export interface VolumeCapacityOptions {
  volumeId: string
  pending: () => Promise<PendingContentReferences & { complete: true }> | (PendingContentReferences & { complete: true })
  allocation?: (object: VerifiedContentObject) => CapacityAllocationEvidence
}

function add(total: number, value: number): number | null {
  const next = total + value
  return Number.isSafeInteger(next) ? next : null
}

async function replicaSnapshot(volumeRoot: string): Promise<{ bytes: number | null; fingerprint: string; blockers: StorageCapacityBlocker[] }> {
  const root = resolve(volumeRoot, '.ash', 'sync'); let bytes: number | null = 0; const entries: string[] = []; const blockers: StorageCapacityBlocker[] = []
  async function walk(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Replica trees must not contain links or junctions')
    const item = `${relative(root, path)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`; entries.push(item)
    if (stat.isFile()) { if (bytes !== null) bytes = add(bytes, stat.size); if (bytes === null) throw new Error('Replica byte total overflowed the safe integer range'); return }
    if (!stat.isDirectory()) throw new Error('Replica entry is not an ordinary file or directory')
    for (const name of (await readdir(path)).sort()) await walk(resolve(path, name))
  }
  try { await walk(root) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') blockers.push({ code: 'replica-unreadable', path: relative(volumeRoot, root), detail: error instanceof Error ? error.message : String(error) })
  }
  return { bytes, fingerprint: entries.sort().join('|'), blockers }
}

async function cleanableSnapshot(volumeRoot: string, objects: VerifiedContentObject[], allocation: (object: VerifiedContentObject) => CapacityAllocationEvidence): Promise<{ bytes: number | null; fingerprint: string; blockers: StorageCapacityBlocker[] }> {
  const root = resolve(volumeRoot, '.ash', 'gc', 'quarantine'); const blockers: StorageCapacityBlocker[] = []; const fingerprints: string[] = []; let bytes: number | null = 0
  try {
    const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Quarantine root must be an ordinary directory')
    const byHash = new Map(objects.map((object) => [object.hash, object]))
    for (const name of (await readdir(root)).sort()) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`Invalid quarantine entry ${name}`)
      const hash = name.slice(0, -5); const object = byHash.get(hash); if (!object) throw new Error(`Quarantine candidate ${name} has no unchanged CAS object`)
      const candidate = await readGarbageCollectionCandidateStable(resolve(root, name), hash)
      if (candidate.size !== object.size || candidate.identity !== object.identity || candidate.mtimeMs !== object.mtimeMs || object.links !== 1) throw new Error(`Quarantine candidate ${name} is not unchanged`)
      await validateGarbageCandidateObject(object, candidate)
      const observed = allocation(object)
      if (observed.allocatedBytes === null || observed.evidence === 'unavailable' || !Number.isSafeInteger(observed.allocatedBytes) || observed.allocatedBytes < 0) throw new Error(`Allocation unavailable for ${hash}`)
      if (bytes !== null) bytes = add(bytes, observed.allocatedBytes); if (bytes === null) throw new Error('Cleanable byte total overflowed the safe integer range')
      fingerprints.push(JSON.stringify(candidate))
    }
    return { bytes, fingerprint: fingerprints.join('|'), blockers }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, fingerprint: '', blockers }
    blockers.push({ code: 'cleanable-unverified', path: relative(volumeRoot, root), detail: error instanceof Error ? error.message : String(error) })
    return { bytes: null, fingerprint: fingerprints.join('|'), blockers }
  }
}

function scanFingerprint(scan: VolumeReferenceScan): string {
  return JSON.stringify({
    logical: scan.logicalImmutableBytes,
    live: [...scan.liveHashes].sort(),
    objects: scan.objects.map((item) => [item.hash, item.size, item.mtimeMs, item.identity, item.links, item.allocatedBytes, item.allocationEvidence]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    blockers: scan.blockers,
  })
}

async function readSnapshot(volumeRoot: string, options: VolumeCapacityOptions, allocation: (object: VerifiedContentObject) => CapacityAllocationEvidence) {
  const pending = await options.pending(); const scan = await scanVolumeReferencesReadOnly(volumeRoot, pending); const replicas = await replicaSnapshot(volumeRoot); const blockers: StorageCapacityBlocker[] = [...scan.blockers, ...replicas.blockers]
  let physical: number | null = 0; const observedAllocations: Array<[string, number | null, string]> = []
  for (const object of scan.objects) {
    const observed = allocation(object); observedAllocations.push([object.hash, observed.allocatedBytes, observed.evidence])
    if (observed.allocatedBytes === null || observed.evidence === 'unavailable' || !Number.isSafeInteger(observed.allocatedBytes) || observed.allocatedBytes < 0) { blockers.push({ code: 'allocation-unavailable', path: relative(volumeRoot, object.path), detail: 'Verified allocation evidence is unavailable' }); physical = null; break }
    if (physical !== null) physical = add(physical, observed.allocatedBytes)
    if (physical === null) { blockers.push({ code: 'allocation-unavailable', detail: 'Physical immutable byte total overflowed the safe integer range' }); break }
  }
  const cleanable = await cleanableSnapshot(volumeRoot, scan.objects, allocation); blockers.push(...cleanable.blockers)
  const fingerprint = JSON.stringify({ scan: scanFingerprint(scan), replicas: [replicas.bytes, replicas.fingerprint], cleanable: [cleanable.bytes, cleanable.fingerprint], allocations: observedAllocations, blockers })
  return { scan, replicas, physical, cleanable, blockers, fingerprint }
}

export async function measureVolumeCapacity(volumeRoot: string, options: VolumeCapacityOptions): Promise<StorageVolumeCapacityMetrics> {
  if (!options || typeof options.pending !== 'function') throw new Error('A mandatory pending-operation inspector is required')
  const allocation = options.allocation ?? ((object: VerifiedContentObject) => ({ allocatedBytes: object.allocatedBytes, evidence: object.allocationEvidence }))
  try {
    const first = await readSnapshot(volumeRoot, options, allocation); const second = await readSnapshot(volumeRoot, options, allocation)
    const stable = first.fingerprint === second.fingerprint
    const blockers = [...second.blockers, ...(!stable ? [{ code: 'concurrent-change', detail: 'Capacity inputs changed between read-only scans' }] : [])]
    const complete = stable && second.scan.complete && second.scan.logicalImmutableBytes !== null && second.replicas.bytes !== null && second.physical !== null && blockers.length === 0
    return { volumeId: options.volumeId, scanStatus: complete ? 'complete' : 'degraded', logicalImmutableBytes: stable ? second.scan.logicalImmutableBytes : null, physicalImmutableBytes: complete ? second.physical : null, verifiedDedupSavedBytes: complete ? Math.max(0, second.scan.logicalImmutableBytes! - second.physical!) : null, replicaBytes: stable ? second.replicas.bytes : null, cleanableBytes: stable ? second.cleanable.bytes : null, scannedAt: second.scan.scannedAt, blockers }
  } catch (error) {
    return { volumeId: options.volumeId, scanStatus: 'degraded', logicalImmutableBytes: null, physicalImmutableBytes: null, verifiedDedupSavedBytes: null, replicaBytes: null, cleanableBytes: null, scannedAt: new Date().toISOString(), blockers: [{ code: 'measurement-unavailable', detail: error instanceof Error ? error.message : String(error) }] }
  }
}
