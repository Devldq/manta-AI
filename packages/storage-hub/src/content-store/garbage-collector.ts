import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureSafeDirectory, hashFileSha256 } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'
import { scanVolumeReferencesUnderLease, type PendingContentReferences, type ReferenceScanBlocker } from './reference-scan'

interface Candidate { schemaVersion: 1; hash: string; size: number; identity: string; quarantinedAt: string }
export interface GarbageCollectionResult { status: 'complete' | 'degraded'; cleanableBytes: number | null; deletedBytes: number; quarantined: string[]; deleted: string[]; blockers: ReferenceScanBlocker[]; scannedAt: string }
export interface GarbageCollectorOptions { pending?: () => Promise<PendingContentReferences> | PendingContentReferences }
const HASH = /^[a-f0-9]{64}$/

function parseCandidate(text: string, expectedHash: string): Candidate {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('Candidate is not an object')
  const item = value as Candidate
  if (item.schemaVersion !== 1 || item.hash !== expectedHash || !HASH.test(item.hash) || !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.identity !== 'string' || !item.identity || Number.isNaN(Date.parse(item.quarantinedAt))) throw new Error('Candidate schema or identity is invalid')
  return item
}

export class VolumeContentGarbageCollector {
  readonly volumeRoot: string
  constructor(volumeRoot: string, private readonly options: GarbageCollectorOptions = {}) { this.volumeRoot = resolve(volumeRoot) }

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

    const pending = await this.options.pending?.() ?? {}
    const scan = await scanVolumeReferencesUnderLease(this.volumeRoot, pending); const blockers = [...scan.blockers, ...candidateBlockers]
    if (!scan.complete || blockers.length) return { status: 'degraded', cleanableBytes: null, deletedBytes: 0, quarantined: [], deleted: [], blockers, scannedAt: scan.scannedAt }

    await ensureSafeDirectory(this.volumeRoot, quarantineRoot)
    for (const [hash] of candidateFiles) if (scan.liveHashes.has(hash) || !scan.objects.some((object) => object.hash === hash)) { await rm(resolve(quarantineRoot, `${hash}.json`), { force: true }); candidateFiles.delete(hash) }
    const quarantined: string[] = []; const deleted: string[] = []; let deletedBytes = 0
    for (const object of scan.objects) {
      if (scan.liveHashes.has(object.hash) || object.links !== 1) continue
      const candidate = candidateFiles.get(object.hash)
      if (!candidate) {
        const record: Candidate = { schemaVersion: 1, hash: object.hash, size: object.size, identity: object.identity, quarantinedAt: scan.scannedAt }
        const target = resolve(quarantineRoot, `${object.hash}.json`); const temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx' }); await rename(temporary, target); quarantined.push(object.hash); candidateFiles.set(object.hash, record); continue
      }
      if (candidate.size !== object.size || candidate.identity !== object.identity) { await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); candidateFiles.delete(object.hash); continue }
      const beforeDelete = await lstat(object.path); const digest = await hashFileSha256(object.path)
      const identity = `${beforeDelete.dev}:${beforeDelete.ino}:${beforeDelete.birthtimeMs}`
      if (!beforeDelete.isFile() || beforeDelete.isSymbolicLink() || beforeDelete.nlink !== 1 || beforeDelete.size !== candidate.size || identity !== candidate.identity || digest.hash !== candidate.hash || digest.size !== candidate.size) continue
      await unlink(object.path); await rm(resolve(quarantineRoot, `${object.hash}.json`), { force: true }); deleted.push(object.hash); deletedBytes += object.size; candidateFiles.delete(object.hash)
    }
    const cleanableBytes = scan.objects.filter((object) => candidateFiles.has(object.hash) && object.links === 1).reduce((sum, object) => sum + object.size, 0)
    return { status: 'complete', cleanableBytes, deletedBytes, quarantined, deleted, blockers: [], scannedAt: scan.scannedAt }
  }
}
