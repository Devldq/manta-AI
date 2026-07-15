import { randomUUID } from 'node:crypto'
import { lstat, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureSafeDirectory } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'
import { scanVolumeReferencesUnderLease, type PendingContentReferences, type ReferenceScanBlocker, type VerifiedContentObject } from './reference-scan'
import { readGarbageCollectionCandidateStable, validateGarbageCandidateObject, type GarbageCollectionCandidate } from './garbage-candidate'

type Candidate = GarbageCollectionCandidate
export interface GarbageCollectionResult { status: 'complete' | 'degraded'; cleanableBytes: number | null; deletedBytes: number; quarantined: string[]; deleted: string[]; blockers: ReferenceScanBlocker[]; scannedAt: string }
export interface VerifiedPendingContentReferences extends PendingContentReferences { complete: true }
export interface GarbageCollectorOptions {
  pending: () => Promise<VerifiedPendingContentReferences> | VerifiedPendingContentReferences
  allocation?: (object: VerifiedContentObject) => { allocatedBytes: number | null; evidence: string }
  beforeDeleteValidation?: (path: string) => void | Promise<void>
}
const HASH = /^[a-f0-9]{64}$/

export class VolumeContentGarbageCollector {
  readonly volumeRoot: string
  constructor(volumeRoot: string, private readonly options: GarbageCollectorOptions) {
    if (!options || typeof options.pending !== 'function') throw new Error('A verified pending-operation inspector is required for garbage collection')
    this.volumeRoot = resolve(volumeRoot)
  }

  scan(): Promise<GarbageCollectionResult> { return withVolumeContentStoreLease(this.volumeRoot, () => this.scanUnderLease()) }

  private async scanUnderLease(): Promise<GarbageCollectionResult> {
    const quarantineRoot = resolve(this.volumeRoot, '.ash', 'gc', 'quarantine'); const candidateFiles = new Map<string, Candidate>(); const candidateBlockers: ReferenceScanBlocker[] = []
    try {
      for (const name of await readdir(quarantineRoot)) {
        const hash = name.endsWith('.json') ? name.slice(0, -5) : ''
        try { if (!HASH.test(hash)) throw new Error('Unexpected quarantine entry'); candidateFiles.set(hash, await readGarbageCollectionCandidateStable(resolve(quarantineRoot, name), hash)) }
        catch (error) { candidateBlockers.push({ code: 'object-integrity', path: `.ash/gc/quarantine/${name}`, detail: error instanceof Error ? error.message : String(error) }) }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') candidateBlockers.push({ code: 'object-tree-unreadable', path: '.ash/gc/quarantine', detail: error instanceof Error ? error.message : String(error) }) }

    let pending: VerifiedPendingContentReferences
    try {
      pending = await this.options.pending()
      if (pending.complete !== true) throw new Error('Pending-operation inspection did not prove completeness')
    } catch (error) {
      const pendingBlocker: ReferenceScanBlocker = { code: 'pending-operation', detail: error instanceof Error ? error.message : String(error) }
      return { status: 'degraded', cleanableBytes: null, deletedBytes: 0, quarantined: [], deleted: [], blockers: [...candidateBlockers, pendingBlocker], scannedAt: new Date().toISOString() }
    }
    const scan = await scanVolumeReferencesUnderLease(this.volumeRoot, pending); const blockers = [...scan.blockers, ...candidateBlockers]
    if (!scan.complete || blockers.length) return { status: 'degraded', cleanableBytes: null, deletedBytes: 0, quarantined: [], deleted: [], blockers, scannedAt: scan.scannedAt }

    const quarantined: string[] = []; const deleted: string[] = []; let deletedBytes = 0; let cleanableBytes: number | null = null; const newlyQuarantined = new Set<string>()
    const allocation = (object: VerifiedContentObject): number | null => {
      const observed = this.options.allocation?.(object) ?? { allocatedBytes: object.allocatedBytes, evidence: object.allocationEvidence }
      return observed.evidence !== 'unavailable' && observed.allocatedBytes !== null && Number.isSafeInteger(observed.allocatedBytes) && observed.allocatedBytes >= 0 ? observed.allocatedBytes : null
    }
    const validateCandidate = (object: VerifiedContentObject, candidate: Candidate, invokeHook: boolean): Promise<void> => validateGarbageCandidateObject(object, candidate, invokeHook ? this.options.beforeDeleteValidation : undefined)
    try {
      const verifiedAllocations = new Map<string, number>(); let prospectiveTotal = 0
      for (const object of scan.objects.filter((item) => !scan.liveHashes.has(item.hash) && item.links === 1)) {
        const bytes = allocation(object)
        if (bytes === null) throw new Error('Verified allocation evidence is unavailable or unsafe')
        const next = prospectiveTotal + bytes
        if (!Number.isSafeInteger(next)) throw new Error('Verified allocation byte total overflowed the safe integer range')
        prospectiveTotal = next; verifiedAllocations.set(object.hash, bytes)
      }
      await ensureSafeDirectory(this.volumeRoot, quarantineRoot)
      for (const [hash] of candidateFiles) if (scan.liveHashes.has(hash) || !scan.objects.some((object) => object.hash === hash)) { await rm(resolve(quarantineRoot, `${hash}.json`), { force: true }); candidateFiles.delete(hash) }
      for (const object of scan.objects) {
        if (scan.liveHashes.has(object.hash) || object.links !== 1) continue
        const candidate = candidateFiles.get(object.hash)
        if (!candidate) {
          const objectStat = await lstat(object.path); const observedIdentity = `${objectStat.dev}:${objectStat.ino}:${objectStat.birthtimeMs}`
          if (observedIdentity !== object.identity || objectStat.size !== object.size || objectStat.nlink !== 1) throw new Error('CAS object changed while entering quarantine')
          const record: Candidate = { schemaVersion: 1, hash: object.hash, size: object.size, identity: object.identity, mtimeMs: objectStat.mtimeMs, quarantinedAt: scan.scannedAt }
          const target = resolve(quarantineRoot, `${object.hash}.json`); const temporary = `${target}.${randomUUID()}.tmp`
          await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx' }); await rename(temporary, target); quarantined.push(object.hash); newlyQuarantined.add(object.hash); candidateFiles.set(object.hash, record); continue
        }
        if (candidate.size !== object.size || candidate.identity !== object.identity) { await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); candidateFiles.delete(object.hash); throw new Error('Quarantine candidate identity changed between scan generations') }
      }
      const eligible = scan.objects.filter((object) => candidateFiles.has(object.hash) && !newlyQuarantined.has(object.hash) && !scan.liveHashes.has(object.hash) && object.links === 1)
      for (const object of eligible) await validateCandidate(object, candidateFiles.get(object.hash)!, true)
      const cleanableObjects = scan.objects.filter((object) => candidateFiles.has(object.hash) && !scan.liveHashes.has(object.hash) && object.links === 1)
      let total = 0
      for (const object of cleanableObjects) {
        const bytes = verifiedAllocations.get(object.hash)
        if (bytes === undefined) throw new Error('Verified allocation evidence is unavailable or unsafe')
        const next = total + bytes
        if (!Number.isSafeInteger(next)) throw new Error('Verified allocation byte total overflowed the safe integer range')
        total = next
      }
      cleanableBytes = total
      const selected = eligible[0]
      if (selected) {
        const candidate = candidateFiles.get(selected.hash)!; await validateCandidate(selected, candidate, false)
        const finalPath = await lstat(selected.path); const finalIdentity = `${finalPath.dev}:${finalPath.ino}:${finalPath.birthtimeMs}`
        if (!finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.nlink !== 1 || finalPath.size !== candidate.size || finalPath.mtimeMs !== candidate.mtimeMs || finalIdentity !== candidate.identity) throw new Error('CAS object path changed immediately before unlink')
        await rm(resolve(quarantineRoot, `${selected.hash}.json`)); candidateFiles.delete(selected.hash)
        const selectedAllocation = verifiedAllocations.get(selected.hash)
        if (selectedAllocation === undefined || !Number.isSafeInteger(deletedBytes + selectedAllocation)) throw new Error('Deleted allocation byte total is unavailable or unsafe')
        await unlink(selected.path); deleted.push(selected.hash); deletedBytes += selectedAllocation; cleanableBytes = total - selectedAllocation
      }
    } catch (error) {
      return { status: 'degraded', cleanableBytes: null, deletedBytes: 0, quarantined, deleted: [], blockers: [{ code: 'object-integrity', detail: error instanceof Error ? error.message : String(error) }], scannedAt: scan.scannedAt }
    }
    return { status: 'complete', cleanableBytes, deletedBytes, quarantined, deleted, blockers: [], scannedAt: scan.scannedAt }
  }
}
