import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { durableAtomicWrite, durableMkdir } from './durable-atomic'

export interface RagUploadStorageOptions {
  cacheUploadsRoot: string
  documentsRoot: string
  maxBytes?: number
}

export interface StoredRagDocument {
  absolutePath: string
  relativePath: string
  sha256: string
  size: number
  safeName: string
}
const activeUploads = new Map<string, number>()

function safeUploadName(input: string): string {
  const leaf = basename(input.replaceAll('\\', '/')).replace(/[^\p{L}\p{N}._-]+/gu, '_')
  const normalized = leaf.replace(/^\.+/, '').slice(0, 180)
  return normalized || 'document'
}

export function createRagUploadStorage(options: RagUploadStorageOptions) {
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024
  return {
    async ingest<T>(source: Readable, originalName: string, processStaged: (stagedPath: string, document: StoredRagDocument) => Promise<T>): Promise<StoredRagDocument & { result: T }> {
      activeUploads.set(options.cacheUploadsRoot, (activeUploads.get(options.cacheUploadsRoot) ?? 0) + 1)
      durableMkdir(options.cacheUploadsRoot)
      const stagedPath = join(options.cacheUploadsRoot, `${randomUUID()}.upload`)
      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          if (size > maxBytes) return callback(new Error(`Upload exceeds ${maxBytes} byte limit`))
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      try {
        await pipeline(source, meter, createWriteStream(stagedPath, { flags: 'wx' }))
        if (size === 0) throw new Error('Uploaded file is empty')
        const sha256 = hash.digest('hex')
        const safeName = safeUploadName(originalName)
        durableMkdir(options.documentsRoot)
        // Content-addressed names are safe on every supported filesystem and
        // make concurrent, differently named uploads converge on one object.
        const storedName = sha256
        const absolutePath = join(options.documentsRoot, storedName)
        const document = { absolutePath, relativePath: posix.join('documents', storedName), sha256, size, safeName }
        const transactionId = basename(stagedPath, '.upload'); const orphanRoot = join(dirname(options.documentsRoot), '.orphans', sha256); durableMkdir(orphanRoot); const orphanPath = join(orphanRoot, `${transactionId}.json`)
        durableAtomicWrite(orphanPath, JSON.stringify({ version: 1, hash: sha256, transactionId, createdAt: new Date().toISOString(), status: 'pending-pipeline' }))
        if (!existsSync(absolutePath)) {
          try { await copyFile(stagedPath, absolutePath, constants.COPYFILE_EXCL) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { await unlink(orphanPath).catch(() => undefined); throw error } }
        }
        const result = await processStaged(stagedPath, document)
        await unlink(orphanPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        try { if (!readdirSync(orphanRoot).length) rmSync(orphanRoot, { recursive: true }) } catch { /* another owner is changing */ }
        return { result, ...document }
      } finally {
        await unlink(stagedPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        const remaining = (activeUploads.get(options.cacheUploadsRoot) ?? 1) - 1
        if (remaining) activeUploads.set(options.cacheUploadsRoot, remaining); else activeUploads.delete(options.cacheUploadsRoot)
      }
    },
  }
}

export function createRagUploadResources(initialCacheRoot: string, initialKnowledgeRoot: string, isReferenced: (hash: string) => Promise<boolean>) {
  let cacheRoot = initialCacheRoot; let knowledgeRoot = initialKnowledgeRoot
  const idle = () => {
    if (activeUploads.get(cacheRoot)) return { ok: false, error: 'RAG uploads are still active' }
    try { inspectRagOrphans(knowledgeRoot); return { ok: true } } catch (error) { return { ok: false, error: String(error) } }
  }
  const common = {
    async checkpoint() { const status = idle(); if (!status.ok) throw new Error(status.error); await cleanupRagOrphans(knowledgeRoot, { olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), isReferenced }) },
    close() { const status = idle(); if (!status.ok) throw new Error(status.error) },
    integrityCheck: idle,
  }
  return {
    cache: { ...common, reopen(nextRoot: string) { const status = idle(); if (!status.ok) throw new Error(status.error); cacheRoot = join(nextRoot, 'uploads') } },
    knowledge: { ...common, reopen(nextRoot: string) { const status = idle(); if (!status.ok) throw new Error(status.error); knowledgeRoot = nextRoot } },
  }
}

export interface RagOrphanRecord { version: 1; hash: string; transactionId: string; createdAt: string; status: 'pending-pipeline' }
export function inspectRagOrphans(knowledgeRoot: string): RagOrphanRecord[] {
  const root = join(knowledgeRoot, '.orphans'); if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((hashDir) => {
    if (hashDir.name.includes('.tmp')) { rmSync(join(root, hashDir.name), { recursive: true, force: true }); return [] }
    if (!hashDir.isDirectory() || !/^[a-f0-9]{64}$/.test(hashDir.name)) throw new Error(`Invalid RAG orphan hash directory: ${hashDir.name}`)
    const hashRoot = join(root, hashDir.name); const names = readdirSync(hashRoot); for (const name of names.filter((item) => item.includes('.tmp'))) rmSync(join(hashRoot, name), { force: true }); const records = readdirSync(hashRoot).filter((name) => name.endsWith('.json')).map((name) => {
    const record = JSON.parse(readFileSync(join(root, hashDir.name, name), 'utf8')) as RagOrphanRecord
    if (record.version !== 1 || record.hash !== hashDir.name || name !== `${record.transactionId}.json` || !record.transactionId || Number.isNaN(Date.parse(record.createdAt)) || record.status !== 'pending-pipeline') throw new Error(`Invalid RAG orphan record: ${name}`)
    return record
  }); if (!records.length && !readdirSync(hashRoot).length) rmSync(hashRoot, { recursive: true }); return records })
}
export async function cleanupRagOrphans(knowledgeRoot: string, options: { olderThan: Date; isReferenced(hash: string): Promise<boolean> }): Promise<string[]> {
  const removed: string[] = []
  for (const record of inspectRagOrphans(knowledgeRoot)) {
    if (new Date(record.createdAt) >= options.olderThan || await options.isReferenced(record.hash)) continue
    const ownerDir = join(knowledgeRoot, '.orphans', record.hash); await unlink(join(ownerDir, `${record.transactionId}.json`))
    if (readdirSync(ownerDir).length) continue
    await unlink(join(knowledgeRoot, 'documents', record.hash)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error }); rmSync(ownerDir, { recursive: true }); removed.push(record.hash)
  }
  return removed
}
