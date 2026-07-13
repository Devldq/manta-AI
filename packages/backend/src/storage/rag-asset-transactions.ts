import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { VolumeObjectStore } from '@manta/storage-hub'
import { durableAtomicWrite, durableMkdir, durableRemove } from './durable-atomic'
import { createContentAssetService } from './content-assets'
import { acquireStorageFileLock } from './file-lock'

const HASH = /^[a-f0-9]{64}$/
const TRANSACTION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const DOCUMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/
const JOURNAL_KEYS = ['assetId', 'createdAt', 'documentId', 'hash', 'phase', 'safeName', 'schemaVersion', 'size', 'sourcePath', 'transactionId'] as const

export type RagAssetTransactionPhase = 'prepared' | 'pipeline-committed'
export type RagAssetFaultPoint = 'after-prepared' | 'after-pipeline-committed' | 'before-cleanup'

export interface RagAssetTransactionRecord {
  schemaVersion: 1
  transactionId: string
  phase: RagAssetTransactionPhase
  assetId: string
  documentId: string
  safeName: string
  hash: string
  size: number
  sourcePath: string
  createdAt: string
}

export interface RagAssetTransactionRoots { volumeRoot: string; knowledgeRoot: string }
const hashLockTails = new Map<string, Promise<void>>()

export async function withRagHashLock<T>(knowledgeRoot: string, hash: string, operation: () => T | Promise<T>): Promise<T> {
  if (!HASH.test(hash)) throw new Error('RAG hash lock requires a lowercase SHA-256 digest')
  const lockPath = join(resolve(knowledgeRoot), '.locks', `${hash}.lock`)
  const previous = hashLockTails.get(lockPath) ?? Promise.resolve()
  let releaseLocal!: () => void
  const gate = new Promise<void>((resolveGate) => { releaseLocal = resolveGate })
  const tail = previous.then(() => gate)
  hashLockTails.set(lockPath, tail)
  await previous
  let releaseFile: (() => void) | undefined
  try {
    durableMkdir(resolve(lockPath, '..'))
    releaseFile = acquireStorageFileLock(lockPath)
    return await operation()
  } finally {
    releaseFile?.()
    releaseLocal()
    if (hashLockTails.get(lockPath) === tail) hashLockTails.delete(lockPath)
  }
}

export function matchesReadyRagDocument(
  record: Pick<RagAssetTransactionRecord, 'documentId' | 'assetId' | 'hash'>,
  document: { id?: unknown; status?: unknown; sourceSha256?: unknown; sourcePath?: unknown } | null | undefined,
): boolean {
  return document?.id === record.documentId
    && document.status === 'ready'
    && document.sourceSha256 === record.hash
    && document.sourcePath === `asset:${record.assetId}`
}

function isContained(root: string, child: string): boolean {
  const value = relative(resolve(root), resolve(child))
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..\\') && !value.startsWith('../'))
}

function assertSafeDirectory(root: string, directory: string, create: boolean): void {
  const base = resolve(root); const target = resolve(directory)
  if (!isContained(base, target)) throw new Error('RAG asset transaction path is outside its volume root')
  const baseStat = lstatSync(base)
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new Error('RAG asset transaction volume root must be an ordinary directory')
  let current = base
  for (const segment of relative(base, target).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment)
    if (!existsSync(current)) {
      if (!create) return
      durableMkdir(current)
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('RAG asset transaction path contains a symbolic link, junction, reparse point, or non-directory ancestor')
  }
}

function normalizeRoots(input: RagAssetTransactionRoots): { volumeRoot: string; knowledgeRoot: string; journalRoot: string } {
  const volumeRoot = resolve(input.volumeRoot); const knowledgeRoot = resolve(input.knowledgeRoot)
  if (!isContained(volumeRoot, knowledgeRoot) || knowledgeRoot === volumeRoot) throw new Error('RAG knowledge root must be a child of its volume root')
  assertSafeDirectory(volumeRoot, knowledgeRoot, false)
  return { volumeRoot, knowledgeRoot, journalRoot: join(knowledgeRoot, '.asset-transactions') }
}

function rootRelative(root: string, target: string, label: string): string {
  const value = relative(root, resolve(target)).replaceAll('\\', '/')
  if (!value || isAbsolute(value) || value === '..' || value.startsWith('../') || /^[a-zA-Z]:/.test(value)) throw new Error(`${label} must be a non-empty root-relative path`)
  return value
}

function resolveRootRelative(root: string, value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || /^[\\/]/.test(value) || /^[a-zA-Z]:[\\/]/.test(value)) throw new Error(`${label} must be root-relative`)
  const parts = value.split(/[\\/]+/)
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`${label} contains an unsafe path segment`)
  const target = resolve(root, ...parts)
  if (!isContained(root, target)) throw new Error(`${label} is outside its volume root`)
  return target
}

function parseRecord(raw: unknown, expectedId: string, roots: ReturnType<typeof normalizeRoots>): RagAssetTransactionRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RAG asset transaction journal must be an object')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).sort().join('\0') !== [...JOURNAL_KEYS].sort().join('\0')) throw new Error('RAG asset transaction journal schema is invalid')
  if (value.schemaVersion !== 1 || !TRANSACTION_ID.test(String(value.transactionId)) || value.transactionId !== expectedId) throw new Error('RAG asset transaction journal identity is invalid')
  if (value.phase !== 'prepared' && value.phase !== 'pipeline-committed') throw new Error('RAG asset transaction journal phase is invalid')
  if (!DOCUMENT_ID.test(String(value.documentId)) || value.assetId !== `document.${value.documentId}`) throw new Error('RAG asset transaction document identity is invalid')
  if (typeof value.safeName !== 'string' || !value.safeName || value.safeName.length > 180 || /[\\/]/.test(value.safeName)) throw new Error('RAG asset transaction document name is invalid')
  if (!HASH.test(String(value.hash)) || !Number.isSafeInteger(value.size) || Number(value.size) < 0 || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw new Error('RAG asset transaction content metadata is invalid')
  const source = resolveRootRelative(roots.volumeRoot, value.sourcePath, 'RAG asset transaction source path')
  const expectedSource = resolve(roots.knowledgeRoot, 'documents', String(value.hash))
  if (source !== expectedSource) throw new Error('RAG asset transaction source path does not match its knowledge object')
  assertSafeDirectory(roots.volumeRoot, resolve(source, '..'), false)
  return value as unknown as RagAssetTransactionRecord
}

function journalPath(journalRoot: string, transactionId: string): string {
  if (!TRANSACTION_ID.test(transactionId)) throw new Error('RAG asset transaction identifier is invalid')
  return join(journalRoot, `${transactionId}.json`)
}

function readRecord(path: string, expectedId: string, roots: ReturnType<typeof normalizeRoots>): RagAssetTransactionRecord {
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { throw new Error(`RAG asset transaction journal is invalid: ${path}`, { cause: error }) }
  return parseRecord(parsed, expectedId, roots)
}

function writeRecord(path: string, record: RagAssetTransactionRecord): void {
  durableAtomicWrite(path, `${JSON.stringify(record, null, 2)}\n`)
}

export async function beginRagAssetTransaction(input: RagAssetTransactionRoots & { transactionId: string; documentId: string; safeName: string; hash: string; size: number; source: string }): Promise<RagAssetTransactionRecord> {
  const roots = normalizeRoots(input)
  if (!TRANSACTION_ID.test(input.transactionId) || !DOCUMENT_ID.test(input.documentId) || !HASH.test(input.hash) || !Number.isSafeInteger(input.size) || input.size < 0) throw new Error('RAG asset transaction input is invalid')
  return withRagHashLock(roots.knowledgeRoot, input.hash, () => {
    assertSafeDirectory(roots.volumeRoot, roots.journalRoot, true)
    const expectedSource = resolve(roots.knowledgeRoot, 'documents', input.hash)
    if (resolve(input.source) !== expectedSource) throw new Error('RAG asset transaction source must be the ordinary knowledge object')
    assertSafeDirectory(roots.volumeRoot, resolve(expectedSource, '..'), false)
    const stat = lstatSync(expectedSource)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== input.size) throw new Error('RAG asset transaction source must be an ordinary file of the expected size')
    const record: RagAssetTransactionRecord = {
      schemaVersion: 1, transactionId: input.transactionId, phase: 'prepared', assetId: `document.${input.documentId}`,
      documentId: input.documentId, safeName: input.safeName, hash: input.hash, size: input.size,
      sourcePath: rootRelative(roots.volumeRoot, expectedSource, 'RAG asset transaction source path'), createdAt: new Date().toISOString(),
    }
    writeRecord(journalPath(roots.journalRoot, record.transactionId), record)
    return record
  })
}

export async function markRagAssetPipelineCommitted(input: RagAssetTransactionRoots, transactionId: string): Promise<RagAssetTransactionRecord> {
  const roots = normalizeRoots(input); assertSafeDirectory(roots.volumeRoot, roots.journalRoot, false)
  const path = journalPath(roots.journalRoot, transactionId); const observed = readRecord(path, transactionId, roots)
  return withRagHashLock(roots.knowledgeRoot, observed.hash, () => {
    const current = readRecord(path, transactionId, roots)
    if (current.phase === 'pipeline-committed') return current
    const committed: RagAssetTransactionRecord = { ...current, phase: 'pipeline-committed' }
    writeRecord(path, committed); return committed
  })
}

export async function abortPreparedRagAssetTransaction(input: RagAssetTransactionRoots, transactionId: string): Promise<void> {
  const roots = normalizeRoots(input); assertSafeDirectory(roots.volumeRoot, roots.journalRoot, false)
  const path = journalPath(roots.journalRoot, transactionId); const observed = readRecord(path, transactionId, roots)
  await withRagHashLock(roots.knowledgeRoot, observed.hash, () => {
    const current = readRecord(path, transactionId, roots)
    if (current.phase !== 'prepared') throw new Error('Only a prepared RAG asset transaction can be aborted')
    durableRemove(path)
  })
}

async function publishRecord(roots: ReturnType<typeof normalizeRoots>, record: RagAssetTransactionRecord): Promise<void> {
  const object = await new VolumeObjectStore(roots.volumeRoot).verify(record.hash)
  if (object.size !== record.size) throw new Error('RAG asset transaction CAS object size is invalid')
  await createContentAssetService({ volumeRoot: roots.volumeRoot }).publishDocumentObject({ documentId: record.documentId, name: record.safeName, object })
}

function cleanupRecordLocked(roots: ReturnType<typeof normalizeRoots>, record: RagAssetTransactionRecord): void {
  const source = resolveRootRelative(roots.volumeRoot, record.sourcePath, 'RAG asset transaction source path')
  assertSafeDirectory(roots.volumeRoot, resolve(source, '..'), false)
  const orphanRoot = join(roots.knowledgeRoot, '.orphans', record.hash)
  assertSafeDirectory(roots.volumeRoot, orphanRoot, false)
  durableRemove(join(orphanRoot, `${record.transactionId}.json`))
  const hasOtherOrphanOwner = existsSync(orphanRoot) && readdirSync(orphanRoot).length > 0
  const hasOtherTransactionOwner = inspectRagAssetTransactions(roots).some((candidate) => candidate.transactionId !== record.transactionId && candidate.hash === record.hash)
  if (!hasOtherOrphanOwner && !hasOtherTransactionOwner) durableRemove(source)
  if (!hasOtherOrphanOwner && existsSync(orphanRoot)) durableRemove(orphanRoot)
  durableRemove(journalPath(roots.journalRoot, record.transactionId))
}

export async function cleanupRagAssetTransaction(input: RagAssetTransactionRoots, transactionId: string): Promise<void> {
  const roots = normalizeRoots(input); assertSafeDirectory(roots.volumeRoot, roots.journalRoot, false)
  const record = readRecord(journalPath(roots.journalRoot, transactionId), transactionId, roots)
  if (record.phase !== 'pipeline-committed') throw new Error('Prepared RAG asset transaction cannot be cleaned')
  await withRagHashLock(roots.knowledgeRoot, record.hash, () => cleanupRecordLocked(roots, record))
}

export async function recoverRagAssetTransactions(input: RagAssetTransactionRoots, options: { isPipelineCommitted?: (record: RagAssetTransactionRecord) => boolean | Promise<boolean> } = {}): Promise<void> {
  const roots = normalizeRoots(input)
  if (!existsSync(roots.journalRoot)) return
  assertSafeDirectory(roots.volumeRoot, roots.journalRoot, false)
  for (const record of inspectRagAssetTransactions(input)) {
    let recoverable = record
    if (record.phase === 'prepared' && await options.isPipelineCommitted?.(record)) recoverable = await markRagAssetPipelineCommitted(input, record.transactionId)
    if (recoverable.phase === 'pipeline-committed') { await publishRecord(roots, recoverable); await cleanupRagAssetTransaction(input, recoverable.transactionId) }
  }
}

export function inspectRagAssetTransactions(input: RagAssetTransactionRoots): RagAssetTransactionRecord[] {
  const roots = normalizeRoots(input)
  if (!existsSync(roots.journalRoot)) return []
  assertSafeDirectory(roots.volumeRoot, roots.journalRoot, false)
  return readdirSync(roots.journalRoot).sort().map((name) => {
    if (!/^([a-f0-9-]{36})\.json$/.test(name)) throw new Error(`RAG asset transaction journal filename is invalid: ${name}`)
    const transactionId = name.slice(0, -5)
    return readRecord(join(roots.journalRoot, name), transactionId, roots)
  })
}
