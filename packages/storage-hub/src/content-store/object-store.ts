import { createHash, randomUUID } from 'node:crypto'
import { copyFile, link, lstat, mkdir, open, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

const HASH = /^[a-f0-9]{64}$/
const MUTABLE_GROUPS = new Set(['config', 'secrets', 'work', 'diagnostics', 'cache'])
const DATABASE_FILE = /(?:\.(?:db|sqlite|sqlite3)|-(?:wal|shm))$/i

export interface ContentObject { hash: string; size: number; path: string }

export function assertContentHash(hash: string): asserts hash is string {
  if (!HASH.test(hash)) throw new Error('Content object hash must be a lowercase SHA-256 digest')
}

export function isContainedPath(root: string, child: string): boolean {
  const path = relative(resolve(root), resolve(child))
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..\\') && !path.startsWith('../'))
}

export function assertContainedPath(root: string, child: string, message = 'Path escapes its volume'): void {
  if (!isContainedPath(root, child)) throw new Error(message)
}

/** Creates only ordinary directories below an already selected volume root. */
export async function ensureSafeDirectory(root: string, directory: string): Promise<void> {
  const resolvedRoot = resolve(root); const resolvedDirectory = resolve(directory)
  assertContainedPath(resolvedRoot, resolvedDirectory)
  const rootStat = await lstat(resolvedRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Volume root must be an ordinary directory')
  let current = resolvedRoot
  for (const part of relative(resolvedRoot, resolvedDirectory).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, part)
    try {
      const stat = await lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('ASH storage path contains a symlink, junction, or non-directory ancestor')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await mkdir(current) } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError }
      const stat = await lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('ASH storage path contains a symlink, junction, or non-directory ancestor')
    }
  }
}

async function fileDigest(path: string): Promise<{ hash: string; size: number }> {
  const handle = await open(path, 'r')
  try {
    const digest = createHash('sha256'); let size = 0; const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; digest.update(buffer.subarray(0, bytesRead)); size += bytesRead }
    return { hash: digest.digest('hex'), size }
  } finally { await handle.close() }
}

/** Immutable, volume-local SHA-256 object store. It deliberately has no API for mutable application state. */
export class VolumeObjectStore {
  readonly volumeRoot: string
  constructor(volumeRoot: string) { this.volumeRoot = resolve(volumeRoot) }

  async pathFor(hash: string): Promise<string> { assertContentHash(hash); return resolve(this.volumeRoot, '.ash', 'objects', 'sha256', hash.slice(0, 2), hash) }

  private assertIngestible(source: string): void {
    const absolute = resolve(source)
    if (!isContainedPath(this.volumeRoot, absolute)) return
    const parts = relative(this.volumeRoot, absolute).split(/[\\/]/)
    if (parts.includes('.ash') || parts.includes('.git') || MUTABLE_GROUPS.has(parts[0] ?? '') || DATABASE_FILE.test(basename(absolute))) {
      throw new Error('CAS only ingests immutable assets; mutable group, database, Git, and internal state paths are forbidden')
    }
  }

  async ingestFile(source: string): Promise<ContentObject> {
    this.assertIngestible(source)
    return this.ingestVerifiedFile(source)
  }

  async ingestStagedFile(source: string, trustedStagingRoot: string): Promise<ContentObject> {
    const stagingRoot = resolve(trustedStagingRoot); const absolute = resolve(source)
    const parts = relative(this.volumeRoot, stagingRoot).split(/[\\/]/).filter(Boolean)
    if (parts[0] !== 'cache' || !isContainedPath(stagingRoot, absolute) || absolute === stagingRoot) throw new Error('Trusted CAS staging file must be below a cache staging root in this volume')
    await ensureSafeDirectory(this.volumeRoot, dirname(absolute))
    return this.ingestVerifiedFile(absolute)
  }

  private async ingestVerifiedFile(source: string): Promise<ContentObject> {
    const sourceStat = await lstat(source)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('CAS ingestion requires a regular non-symbolic-link file')
    const value = await fileDigest(source); const target = await this.pathFor(value.hash); await ensureSafeDirectory(this.volumeRoot, dirname(target))
    try {
      const existing = await fileDigest(target)
      if (existing.hash !== value.hash || existing.size !== value.size) throw new Error('Existing CAS object failed integrity verification')
      return { ...value, path: target }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = resolve(dirname(target), `.${value.hash}.${randomUUID()}.tmp`)
    try {
      await copyFile(source, temporary)
      const copied = await fileDigest(temporary)
      if (copied.hash !== value.hash || copied.size !== value.size) throw new Error('CAS ingest source changed while being copied')
      try { await link(temporary, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const installed = await fileDigest(target)
      if (installed.hash !== value.hash || installed.size !== value.size) throw new Error('Installed CAS object failed integrity verification')
      return { ...value, path: target }
    } finally { await rm(temporary, { force: true }) }
  }

  async ingestBytes(value: Uint8Array): Promise<ContentObject> {
    const hash = createHash('sha256').update(value).digest('hex'); const target = await this.pathFor(hash); await ensureSafeDirectory(this.volumeRoot, dirname(target))
    try { const existing = await fileDigest(target); if (existing.hash !== hash || existing.size !== value.byteLength) throw new Error('Existing CAS object failed integrity verification'); return { hash, size: value.byteLength, path: target } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = resolve(dirname(target), `.${hash}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, value, { flag: 'wx' })
      try { await link(temporary, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const installed = await fileDigest(target); if (installed.hash !== hash || installed.size !== value.byteLength) throw new Error('Installed CAS object failed integrity verification')
      return { hash, size: value.byteLength, path: target }
    } finally { await unlink(temporary).catch(() => undefined) }
  }

  async verify(hash: string): Promise<ContentObject> { const path = await this.pathFor(hash); const value = await fileDigest(path); if (value.hash !== hash) throw new Error('CAS object hash verification failed'); return { ...value, path } }
}

export const hashFileSha256 = fileDigest
