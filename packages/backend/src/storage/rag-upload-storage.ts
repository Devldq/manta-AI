import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
      mkdirSync(options.cacheUploadsRoot, { recursive: true })
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
        mkdirSync(options.documentsRoot, { recursive: true })
        // Content-addressed names are safe on every supported filesystem and
        // make concurrent, differently named uploads converge on one object.
        const storedName = sha256
        const absolutePath = join(options.documentsRoot, storedName)
        const document = { absolutePath, relativePath: posix.join('documents', storedName), sha256, size, safeName }
        const orphanRoot = join(dirname(options.documentsRoot), '.orphans'); mkdirSync(orphanRoot, { recursive: true }); const orphanPath = join(orphanRoot, `${sha256}.json`)
        const orphanTemp = `${orphanPath}.${randomUUID()}.tmp`; const orphanFd = openSync(orphanTemp, 'wx'); try { writeFileSync(orphanFd, JSON.stringify({ version: 1, hash: sha256, transactionId: basename(stagedPath, '.upload'), createdAt: new Date().toISOString(), status: 'pending-pipeline' }), 'utf8') } finally { closeSync(orphanFd) }; renameSync(orphanTemp, orphanPath)
        if (!existsSync(absolutePath)) {
          try { await copyFile(stagedPath, absolutePath, constants.COPYFILE_EXCL) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { await unlink(orphanPath).catch(() => undefined); throw error } }
        }
        const result = await processStaged(stagedPath, document)
        await unlink(orphanPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        return { result, ...document }
      } finally {
        await unlink(stagedPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        const remaining = (activeUploads.get(options.cacheUploadsRoot) ?? 1) - 1
        if (remaining) activeUploads.set(options.cacheUploadsRoot, remaining); else activeUploads.delete(options.cacheUploadsRoot)
      }
    },
  }
}

export function createRagUploadResources(initialCacheRoot: string, initialKnowledgeRoot: string) {
  let cacheRoot = initialCacheRoot; let knowledgeRoot = initialKnowledgeRoot
  const idle = () => {
    if (activeUploads.get(cacheRoot)) return { ok: false, error: 'RAG uploads are still active' }
    try { inspectRagOrphans(knowledgeRoot); return { ok: true } } catch (error) { return { ok: false, error: String(error) } }
  }
  const common = {
    checkpoint() { const status = idle(); if (!status.ok) throw new Error(status.error) },
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
  return readdirSync(root).filter((name) => name.endsWith('.json')).map((name) => {
    const record = JSON.parse(readFileSync(join(root, name), 'utf8')) as RagOrphanRecord
    if (record.version !== 1 || !/^[a-f0-9]{64}$/.test(record.hash) || name !== `${record.hash}.json` || !record.transactionId || Number.isNaN(Date.parse(record.createdAt)) || record.status !== 'pending-pipeline') throw new Error(`Invalid RAG orphan record: ${name}`)
    return record
  })
}
export async function cleanupRagOrphans(knowledgeRoot: string, options: { olderThan: Date; isReferenced(hash: string): Promise<boolean> }): Promise<string[]> {
  const removed: string[] = []
  for (const record of inspectRagOrphans(knowledgeRoot)) {
    if (new Date(record.createdAt) >= options.olderThan || await options.isReferenced(record.hash)) continue
    await unlink(join(knowledgeRoot, 'documents', record.hash)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    await unlink(join(knowledgeRoot, '.orphans', `${record.hash}.json`)); removed.push(record.hash)
  }
  return removed
}
