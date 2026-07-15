import { lstat, open } from 'node:fs/promises'
import { hashFileHandleSha256 } from './object-store'
import type { VerifiedContentObject } from './reference-scan'

export interface GarbageCollectionCandidate { schemaVersion: 1; hash: string; size: number; identity: string; mtimeMs: number; quarantinedAt: string }
const HASH = /^[a-f0-9]{64}$/
const CANDIDATE_KEYS = ['hash', 'identity', 'mtimeMs', 'quarantinedAt', 'schemaVersion', 'size']
const identity = (stat: { dev: number | bigint; ino: number | bigint; birthtimeMs: number }) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`

export function parseGarbageCollectionCandidate(text: string, expectedHash: string): GarbageCollectionCandidate {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Candidate is not an object')
  const item = value as GarbageCollectionCandidate
  if (Object.keys(item).sort().join('\0') !== CANDIDATE_KEYS.join('\0') || item.schemaVersion !== 1 || item.hash !== expectedHash || !HASH.test(item.hash) || !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.identity !== 'string' || !item.identity || !Number.isFinite(item.mtimeMs) || typeof item.quarantinedAt !== 'string' || Number.isNaN(Date.parse(item.quarantinedAt))) throw new Error('Candidate schema or identity is invalid')
  return item
}

export async function readGarbageCollectionCandidateStable(path: string, expectedHash: string): Promise<GarbageCollectionCandidate> {
  const handle = await open(path, 'r')
  try {
    const before = await handle.stat(); const text = await handle.readFile('utf8'); const after = await handle.stat(); const pathStat = await lstat(path)
    const stableHandle = before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs
    const stablePath = identity(pathStat) === identity(after) && pathStat.size === after.size && pathStat.mtimeMs === after.mtimeMs
    if (!before.isFile() || before.isSymbolicLink() || !stableHandle || !stablePath) throw new Error('Candidate changed while being read')
    return parseGarbageCollectionCandidate(text, expectedHash)
  } finally { await handle.close() }
}

export async function validateGarbageCandidateObject(object: VerifiedContentObject, candidate: GarbageCollectionCandidate, beforePathValidation?: (path: string) => void | Promise<void>): Promise<void> {
  const handle = await open(object.path, 'r')
  try {
    const before = await handle.stat(); const digest = await hashFileHandleSha256(handle); const after = await handle.stat()
    await beforePathValidation?.(object.path)
    const pathStat = await lstat(object.path)
    const stableHandle = before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.nlink === after.nlink && before.mtimeMs === after.mtimeMs
    const stablePath = identity(pathStat) === identity(after) && pathStat.size === after.size && pathStat.nlink === after.nlink && pathStat.mtimeMs === after.mtimeMs
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== candidate.size || identity(before) !== candidate.identity || before.mtimeMs !== candidate.mtimeMs || !stableHandle || !stablePath || digest.hash !== candidate.hash || digest.size !== candidate.size) throw new Error('CAS object identity changed during stable candidate validation')
  } finally { await handle.close() }
}
