import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureSafeDirectory, hashFileHandleSha256 } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'
import { scanVolumeReferencesUnderLease, type PendingContentReferences, type ReferenceScanBlocker, type VerifiedContentObject } from './reference-scan'

interface Candidate { schemaVersion: 1; hash: string; size: number; identity: string; mtimeMs: number; quarantinedAt: string }
export interface GarbageCollectionResult { status: 'complete' | 'degraded'; cleanableBytes: number | null; deletedBytes: number; quarantined: string[]; deleted: string[]; blockers: ReferenceScanBlocker[]; scannedAt: string }
export interface VerifiedPendingContentReferences extends PendingContentReferences { complete: true }
export interface GarbageCollectorOptions {
  pending: () => Promise<VerifiedPendingContentReferences> | VerifiedPendingContentReferences
  allocation?: (object: VerifiedContentObject) => { allocatedBytes: number | null; evidence: string }
  beforeDeleteValidation?: (path: string) => void | Promise<void>
}
const HASH = /^[a-f0-9]{64}$/

function parseCandidate(text: string, expectedHash: string): Candidate {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('Candidate is not an object')
  const item = value as Candidate
  if (item.schemaVersion !== 1 || item.hash !== expectedHash || !HASH.test(item.hash) || !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.identity !== 'string' || !item.identity || !Number.isFinite(item.mtimeMs) || Number.isNaN(Date.parse(item.quarantinedAt))) throw new Error('Candidate schema or identity is invalid')
  return item
}

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
        try { if (!HASH.test(hash)) throw new Error('Unexpected quarantine entry'); const stat = await lstat(resolve(quarantineRoot, name)); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Candidate must be an ordinary file'); candidateFiles.set(hash, parseCandidate(await readFile(resolve(quarantineRoot, name), 'utf8'), hash)) }
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

    await ensureSafeDirectory(this.volumeRoot, quarantineRoot)
    for (const [hash] of candidateFiles) if (scan.liveHashes.has(hash) || !scan.objects.some((object) => object.hash === hash)) { await rm(resolve(quarantineRoot, `${hash}.json`), { force: true }); candidateFiles.delete(hash) }
    const quarantined: string[] = []; const deleted: string[] = []; let deletedBytes = 0
    const allocation = (object: VerifiedContentObject): number | null => {
      const observed = this.options.allocation?.(object) ?? { allocatedBytes: object.allocatedBytes, evidence: object.allocationEvidence }
      return observed.evidence !== 'unavailable' && observed.allocatedBytes !== null && Number.isSafeInteger(observed.allocatedBytes) && observed.allocatedBytes >= 0 ? observed.allocatedBytes : null
    }
    for (const object of scan.objects) {
      if (scan.liveHashes.has(object.hash) || object.links !== 1) continue
      const candidate = candidateFiles.get(object.hash)
      if (!candidate) {
        const objectStat = await lstat(object.path)
        const record: Candidate = { schemaVersion: 1, hash: object.hash, size: object.size, identity: object.identity, mtimeMs: objectStat.mtimeMs, quarantinedAt: scan.scannedAt }
        const target = resolve(quarantineRoot, `${object.hash}.json`); const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx' }); await rename(temporary, target); quarantined.push(object.hash); candidateFiles.set(object.hash, record); continue
      }
      if (candidate.size !== object.size || candidate.identity !== object.identity) { await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); candidateFiles.delete(object.hash); continue }
      const handle = await open(object.path, 'r')
      try {
        const before = await handle.stat(); const digest = await hashFileHandleSha256(handle); const after = await handle.stat()
        await this.options.beforeDeleteValidation?.(object.path)
        const pathStat = await lstat(object.path); const identity = `${before.dev}:${before.ino}:${before.birthtimeMs}`; const pathIdentity = `${pathStat.dev}:${pathStat.ino}:${pathStat.birthtimeMs}`
        const stableHandle = before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.nlink === after.nlink && before.mtimeMs === after.mtimeMs
        const stablePath = pathIdentity === identity && pathStat.size === after.size && pathStat.nlink === after.nlink && pathStat.mtimeMs === after.mtimeMs
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== candidate.size || identity !== candidate.identity || before.mtimeMs !== candidate.mtimeMs || !stableHandle || !stablePath || digest.hash !== candidate.hash || digest.size !== candidate.size) {
          await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); candidateFiles.delete(object.hash)
          return { status: 'degraded', cleanableBytes: null, deletedBytes, quarantined, deleted, blockers: [{ code: 'object-integrity', path: object.path, detail: 'CAS object identity changed during final deletion validation' }], scannedAt: scan.scannedAt }
        }
        await unlink(object.path); await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); deleted.push(object.hash); deletedBytes += object.size; candidateFiles.delete(object.hash)
      } finally { await handle.close() }
    }
    const cleanable = scan.objects.filter((object) => candidateFiles.has(object.hash) && object.links === 1).map(allocation)
    const cleanableBytes = cleanable.some((bytes) => bytes === null) ? null : cleanable.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0)
    return { status: 'complete', cleanableBytes, deletedBytes, quarantined, deleted, blockers: [], scannedAt: scan.scannedAt }
  }
}
