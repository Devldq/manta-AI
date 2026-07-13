import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { resolveStoragePath, safeStorageSegment } from './path-routing'

export interface StagedRagFile {
  version: 1
  id: string
  kbId: string
  name: string
  type: string
  size: number
  sha256: string
  createdAt: string
  expiresAt: string
  sessionId?: string
  claimedAt?: string
  idempotencyKey?: string
}
export interface StageRagFileOptions { name: string; type?: string; idempotencyKey?: string }
export interface RagStagingStoreOptions { ttlMs?: number; maxBytes?: number }

function safeName(name: string): string {
  const leaf = basename(name.replaceAll('\\', '/')).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 180)
  return leaf || 'document'
}

/** Cache-group owned pre-ingest queue. Every visible entry has a durable metadata record. */
export class RagStagingStore {
  private readonly ttlMs: number
  private readonly maxBytes: number
  constructor(options: RagStagingStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024
  }
  async stage(kbId: string, source: Readable, options: StageRagFileOptions): Promise<StagedRagFile> {
    this.assertKb(kbId)
    const existing = options.idempotencyKey ? (await this.list(kbId)).find((entry) => entry.idempotencyKey === options.idempotencyKey) : undefined
    if (existing) return existing
    const cacheRoot = resolveStoragePath('cache'); const root = join(cacheRoot, 'rag-staging', safeStorageSegment(kbId)); await mkdir(root, { recursive: true })
    const temporary = join(root, safeStorageSegment(`.${randomUUID()}.upload`))
    const hash = createHash('sha256'); let size = 0
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; if (size > thisMax) return callback(new Error(`Upload exceeds ${thisMax} byte limit`)); hash.update(chunk); callback(null, chunk) } })
    const thisMax = this.maxBytes
    try { await pipeline(source, meter, createWriteStream(temporary, { flags: 'wx' })) } catch (error) { await rm(temporary, { force: true }); throw error }
    if (size === 0) { await rm(temporary, { force: true }); throw new Error('Uploaded file is empty') }
    const sha256 = hash.digest('hex'); const id = sha256
    const now = new Date(); const entry: StagedRagFile = { version: 1, id, kbId, name: safeName(options.name), type: options.type || 'application/octet-stream', size, sha256, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(), ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey.slice(0, 200) } : {}) }
    const path = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${id}.bin`))
    try { await rename(temporary, path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { await rm(temporary, { force: true }); throw error }; await rm(temporary, { force: true }) }
    const metadata = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${id}.json`))
    if (!existsSync(metadata)) await this.writeMeta(kbId, entry)
    return this.read(kbId, id)
  }
  async list(kbId: string): Promise<StagedRagFile[]> {
    this.assertKb(kbId); const root = this.rootFor(kbId); if (!existsSync(root)) return []
    const entries: StagedRagFile[] = []
    for (const name of readdirSync(root)) if (name.endsWith('.json')) { try { const value = this.parse(readFileSync(join(root, name), 'utf8')); if (existsSync(this.pathFor(kbId, value.id))) entries.push(value) } catch { /* corrupted cache row is never returned */ } }
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async read(kbId: string, id: string): Promise<StagedRagFile> {
    this.assertKb(kbId); this.assertId(id); return this.parse(await readFile(this.metaPath(kbId, id), 'utf8'))
  }
  pathFor(kbId: string, id: string): string { this.assertKb(kbId); this.assertId(id); return join(this.rootFor(kbId), `${id}.bin`) }
  async claim(kbId: string, ids: string[], sessionId: string): Promise<StagedRagFile[]> {
    this.assertKb(kbId); safeStorageSegment(sessionId); const claimed: StagedRagFile[] = []
    for (const id of [...new Set(ids)]) { const prior = await this.read(kbId, id); const entry = { ...prior, sessionId, claimedAt: new Date().toISOString() }; await this.writeMeta(kbId, entry); claimed.push(entry) }
    return claimed
  }
  async remove(kbId: string, id: string): Promise<void> { this.assertKb(kbId); this.assertId(id); const content = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${id}.bin`)); const metadata = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${id}.json`)); await Promise.all([rm(content, { force: true }), rm(metadata, { force: true })]) }
  async cleanupExpired(now = new Date()): Promise<string[]> { const root = this.baseRoot(); if (!existsSync(root)) return []; const removed: string[] = []; for (const kbId of readdirSync(root)) { try { for (const entry of await this.list(kbId)) if (new Date(entry.expiresAt) <= now) { await this.remove(kbId, entry.id); removed.push(entry.id) } } catch { /* isolate one corrupt cache directory */ } } return removed }
  private rootFor(kbId: string): string { return join(this.baseRoot(), safeStorageSegment(kbId)) }
  private baseRoot(): string { return resolveStoragePath('cache', 'rag-staging') }
  private metaPath(kbId: string, id: string): string { return join(this.rootFor(kbId), `${id}.json`) }
  private async writeMeta(kbId: string, entry: StagedRagFile): Promise<void> { const target = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${entry.id}.json`)); const temp = resolveStoragePath('cache', 'rag-staging', safeStorageSegment(kbId), safeStorageSegment(`${entry.id}.${randomUUID()}.tmp`)); await writeFile(temp, JSON.stringify(entry)); await rename(temp, target) }
  private assertKb(kbId: string): void { safeStorageSegment(kbId) }
  private assertId(id: string): void { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Unsafe staged file identifier') }
  private parse(raw: string): StagedRagFile { const value = JSON.parse(raw) as StagedRagFile; if (value?.version !== 1 || !/^[a-f0-9]{64}$/.test(value.id) || typeof value.kbId !== 'string' || typeof value.name !== 'string' || typeof value.size !== 'number' || typeof value.sha256 !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('Invalid staged RAG cache metadata'); return value }
}
