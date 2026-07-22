import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RagUploadSessionSchema, type RagUploadSession } from '@manta/contracts'
import type { RagSourceAsset, RagSourceAssetStore } from './rag-source-assets.js'

export type { RagUploadPart, RagUploadSession } from '@manta/contracts'

const HASH = /^[a-f0-9]{64}$/
const SESSION_ID = /^upload\.[0-9a-f-]{36}$/
const DEFAULT_PART_SIZE = 4 * 1024 * 1024
const MIN_PART_SIZE = 256 * 1024
const MAX_PART_SIZE = 8 * 1024 * 1024
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class RagUploadSessionStore {
  private readonly tails = new Map<string, Promise<unknown>>()

  constructor(private readonly root: string) {}

  async create(input: {
    knowledgeBaseId: string
    name: string
    mediaType?: string
    size: number
    sha256: string
    partSize?: number
    idempotencyKey?: string
  }): Promise<RagUploadSession> {
    this.assertHash(input.sha256)
    if (!Number.isSafeInteger(input.size) || input.size <= 0) throw codedError('INVALID_UPLOAD_SIZE', 'Upload size must be a positive safe integer')
    const partSize = Math.min(MAX_PART_SIZE, Math.max(MIN_PART_SIZE, input.partSize ?? DEFAULT_PART_SIZE))
    if (!Number.isSafeInteger(partSize)) throw codedError('INVALID_PART_SIZE', 'Upload part size must be an integer')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.knowledgeBaseId, input.idempotencyKey)
      if (existing) {
        if (existing.sha256 !== input.sha256 || existing.size !== input.size) throw codedError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for another upload')
        return existing
      }
    }
    const now = new Date()
    const session: RagUploadSession = {
      version: 1,
      id: `upload.${randomUUID()}`,
      knowledgeBaseId: input.knowledgeBaseId,
      name: safeName(input.name),
      mediaType: input.mediaType || 'application/octet-stream',
      size: input.size,
      sha256: input.sha256,
      partSize,
      partCount: Math.ceil(input.size / partSize),
      receivedParts: [],
      status: 'uploading',
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    }
    await this.writeSession(session)
    return session
  }

  async get(id: string): Promise<RagUploadSession | undefined> {
    this.assertSessionId(id)
    try { return this.parse(await readFile(this.metadataPath(id), 'utf8')) }
    catch (error) { if (isMissing(error)) return undefined; throw error }
  }

  async putPart(id: string, number: number, bytes: Buffer, expectedSha256?: string): Promise<RagUploadSession> {
    return this.exclusive(id, async () => {
      const session = await this.require(id)
      if (session.status !== 'uploading') throw codedError('UPLOAD_ALREADY_COMPLETED', `Upload Session ${id} is already complete`)
      if (!Number.isSafeInteger(number) || number < 0 || number >= session.partCount) throw codedError('INVALID_PART_NUMBER', `Part number must be between 0 and ${session.partCount - 1}`)
      const expectedSize = number === session.partCount - 1 ? session.size - session.partSize * number : session.partSize
      if (bytes.length !== expectedSize) throw codedError('INVALID_PART_SIZE', `Part ${number} must contain exactly ${expectedSize} bytes`)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (expectedSha256 && expectedSha256 !== sha256) throw codedError('PART_HASH_MISMATCH', `Part ${number} SHA-256 does not match X-Part-Sha256`)
      const current = session.receivedParts.find((part) => part.number === number)
      if (current) {
        if (current.sha256 !== sha256 || current.size !== bytes.length) throw codedError('PART_CONFLICT', `Part ${number} was already uploaded with different content`)
        return session
      }
      await writeFileAtomic(this.partPath(id, number), bytes)
      const updated: RagUploadSession = {
        ...session,
        receivedParts: [...session.receivedParts, { number, size: bytes.length, sha256, uploadedAt: new Date().toISOString() }].sort((left, right) => left.number - right.number),
        updatedAt: new Date().toISOString(),
      }
      await this.writeSession(updated)
      return updated
    })
  }

  async complete(id: string, sourceAssets: RagSourceAssetStore): Promise<{ session: RagUploadSession; asset: RagSourceAsset }> {
    return this.exclusive(id, async () => {
      const session = await this.require(id)
      if (session.status === 'completed') {
        if (!session.assetId) throw codedError('UPLOAD_SESSION_CORRUPT', `Completed Upload Session ${id} has no assetId`)
        const asset = await sourceAssets.read(session.assetId)
        return { session, asset }
      }
      if (session.receivedParts.length !== session.partCount) {
        const received = new Set(session.receivedParts.map((part) => part.number))
        const missing = Array.from({ length: session.partCount }, (_, number) => number).filter((number) => !received.has(number))
        throw codedError('UPLOAD_INCOMPLETE', `Upload Session is missing parts: ${missing.join(', ')}`)
      }
      const assembledPath = join(this.sessionDirectory(id), 'assembled.tmp')
      await mkdir(dirname(assembledPath), { recursive: true, mode: 0o700 })
      const output = await open(assembledPath, 'w', 0o600)
      const hash = createHash('sha256')
      let total = 0
      try {
        for (let number = 0; number < session.partCount; number++) {
          const part = session.receivedParts[number]
          if (!part || part.number !== number) throw codedError('UPLOAD_INCOMPLETE', `Upload Session is missing part ${number}`)
          const bytes = await readFile(this.partPath(id, number))
          const actual = createHash('sha256').update(bytes).digest('hex')
          if (actual !== part.sha256 || bytes.length !== part.size) throw codedError('PART_HASH_MISMATCH', `Stored part ${number} is corrupt`)
          await output.write(bytes)
          hash.update(bytes)
          total += bytes.length
        }
        await output.sync()
      } finally { await output.close() }
      const actualHash = hash.digest('hex')
      if (total !== session.size || actualHash !== session.sha256) {
        await rm(assembledPath, { force: true })
        throw codedError('UPLOAD_HASH_MISMATCH', `Completed upload does not match the declared size or SHA-256`)
      }
      const asset = sourceAssets.promote(assembledPath, { sha256: session.sha256, name: session.name, mediaType: session.mediaType, size: session.size })
      const updated: RagUploadSession = { ...session, status: 'completed', assetId: asset.assetId, updatedAt: new Date().toISOString() }
      await this.writeSession(updated)
      await Promise.all([
        rm(assembledPath, { force: true }),
        ...session.receivedParts.map((part) => rm(this.partPath(id, part.number), { force: true })),
      ])
      return { session: updated, asset }
    })
  }

  async cancel(id: string): Promise<boolean> {
    this.assertSessionId(id)
    return this.exclusive(id, async () => {
      if (!await this.get(id)) return false
      await rm(this.sessionDirectory(id), { recursive: true, force: true })
      return true
    })
  }

  private async require(id: string): Promise<RagUploadSession> {
    const session = await this.get(id)
    if (!session) throw codedError('UPLOAD_SESSION_NOT_FOUND', `Upload Session ${id} was not found`)
    return session
  }

  private async findByIdempotencyKey(knowledgeBaseId: string, idempotencyKey: string): Promise<RagUploadSession | undefined> {
    let entries: string[]
    try { entries = await readdir(this.root) } catch (error) { if (isMissing(error)) return undefined; throw error }
    for (const id of entries.filter((entry) => SESSION_ID.test(entry)).sort()) {
      const session = await this.get(id)
      if (session?.knowledgeBaseId === knowledgeBaseId && session.idempotencyKey === idempotencyKey) return session
    }
    return undefined
  }

  private async writeSession(session: RagUploadSession): Promise<void> {
    await writeFileAtomic(this.metadataPath(session.id), Buffer.from(`${JSON.stringify(session, null, 2)}\n`))
  }

  private parse(raw: string): RagUploadSession {
    try { return RagUploadSessionSchema.parse(JSON.parse(raw)) }
    catch { throw codedError('UPLOAD_SESSION_CORRUPT', 'Upload Session metadata is invalid') }
  }

  private sessionDirectory(id: string): string { this.assertSessionId(id); return join(this.root, id) }
  private metadataPath(id: string): string { return join(this.sessionDirectory(id), 'session.json') }
  private partPath(id: string, number: number): string { return join(this.sessionDirectory(id), `part-${number}.bin`) }
  private assertHash(hash: string): void { if (!HASH.test(hash)) throw codedError('INVALID_UPLOAD_HASH', 'Upload SHA-256 must contain 64 lowercase hexadecimal characters') }
  private assertSessionId(id: string): void { if (!SESSION_ID.test(id)) throw codedError('INVALID_UPLOAD_SESSION_ID', 'Upload Session ID is invalid') }

  private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.tails.set(id, current)
    return current.finally(() => { if (this.tails.get(id) === current) this.tails.delete(id) })
  }
}

async function writeFileAtomic(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  const directory = await open(dirname(path), 'r')
  try { await directory.sync() } finally { await directory.close() }
}

function safeName(input: string): string {
  const value = input.replaceAll('\\', '/').split('/').at(-1)?.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 180)
  return value || 'document'
}

function codedError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }) }
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
