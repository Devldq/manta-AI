import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
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
        if (!existsSync(absolutePath)) {
          try { await copyFile(stagedPath, absolutePath, constants.COPYFILE_EXCL) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        }
        const result = await processStaged(stagedPath, document)
        return { result, ...document }
      } finally {
        await unlink(stagedPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        const remaining = (activeUploads.get(options.cacheUploadsRoot) ?? 1) - 1
        if (remaining) activeUploads.set(options.cacheUploadsRoot, remaining); else activeUploads.delete(options.cacheUploadsRoot)
      }
    },
  }
}

export function createRagUploadResource(initialCacheRoot: string) {
  let cacheRoot = initialCacheRoot
  const idle = () => activeUploads.get(cacheRoot) ? { ok: false, error: 'RAG uploads are still active' } : { ok: true }
  return {
    checkpoint() { const status = idle(); if (!status.ok) throw new Error(status.error) },
    close() { const status = idle(); if (!status.ok) throw new Error(status.error) },
    integrityCheck: idle,
    reopen(nextCacheRoot: string) { const status = idle(); if (!status.ok) throw new Error(status.error); cacheRoot = join(nextCacheRoot, 'uploads') },
  }
}
