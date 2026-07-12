import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type BundleFaultPhase = 'locked' | 'journaled' | 'after-first-write' | 'committed'
interface BundleJournal { id: string; phase: 'applying' | 'committed'; writes: Array<{ path: string; content: string }>; deletes: string[] }
export interface AtomicBundleOptions { coordinatorPath: string; writes: Map<string, string>; deletes?: string[]; fault?: (phase: BundleFaultPhase) => void }
export interface AtomicBundleView { read(logicalPath: string): string | undefined; write(logicalPath: string, content: string): void; delete(logicalPath: string): void }

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `${basename(path)}.${randomUUID()}.tmp`)
  const fd = openSync(temporary, 'wx')
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temporary, path)
}

function journalPath(coordinatorPath: string): string { return `${coordinatorPath}.journal.json` }
function lockPath(coordinatorPath: string): string { return `${coordinatorPath}.lock` }

function acquire(coordinatorPath: string): () => void {
  const path = lockPath(coordinatorPath)
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    let stale = false
    try {
      const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number }
      if (!Number.isInteger(owner.pid)) stale = false
      else { try { process.kill(owner.pid!, 0) } catch { stale = true } }
    } catch { stale = false }
    if (stale) unlinkSync(path)
  }
  let fd: number
  try { fd = openSync(path, 'wx') } catch (error) { throw new Error('Atomic storage bundle lock is already held', { cause: error }) }
  const token = randomUUID()
  writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })); fsyncSync(fd)
  let released = false
  return () => {
    if (released) return
    released = true; closeSync(fd)
    try { const owner = JSON.parse(readFileSync(path, 'utf8')) as { token?: string }; if (owner.token === token) unlinkSync(path) } catch { /* ownership changed */ }
  }
}

function apply(journal: BundleJournal, fault?: (phase: BundleFaultPhase) => void): void {
  for (let index = 0; index < journal.writes.length; index++) {
    const item = journal.writes[index]
    atomicWrite(item.path, item.content)
    if (index === 0) fault?.('after-first-write')
  }
  for (const path of journal.deletes) rmSync(path, { recursive: true, force: true })
}

function recoverUnlocked(coordinatorPath: string): void {
  const path = journalPath(coordinatorPath)
  if (!existsSync(path)) return
  const journal = JSON.parse(readFileSync(path, 'utf8')) as BundleJournal
  if (journal.phase === 'applying') apply(journal)
  unlinkSync(path)
}

export function recoverAtomicBundle(coordinatorPath: string): void {
  const release = acquire(coordinatorPath)
  try { recoverUnlocked(coordinatorPath) } finally { release() }
}

export function writeAtomicBundle(options: AtomicBundleOptions): void {
  const release = acquire(options.coordinatorPath)
  try {
    options.fault?.('locked')
    recoverUnlocked(options.coordinatorPath)
    const journal: BundleJournal = { id: randomUUID(), phase: 'applying', writes: [...options.writes].map(([path, content]) => ({ path, content })), deletes: options.deletes ?? [] }
    atomicWrite(journalPath(options.coordinatorPath), JSON.stringify(journal, null, 2))
    options.fault?.('journaled')
    apply(journal, options.fault)
    journal.phase = 'committed'; atomicWrite(journalPath(options.coordinatorPath), JSON.stringify(journal, null, 2)); options.fault?.('committed')
    unlinkSync(journalPath(options.coordinatorPath))
  } finally { release() }
}

function authorityPath(root: string, logicalPath: string): string {
  if (!logicalPath || isAbsolute(logicalPath)) throw new Error('Atomic bundle logical path must be root-relative')
  const absolute = resolve(root, logicalPath)
  const rel = relative(resolve(root), absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Atomic bundle journal path escapes its authority root')
  return absolute
}

function recoverAuthorityUnlocked(root: string, directory: string): void {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory).filter((value) => value.endsWith('.journal.json')).sort()) {
    const file = join(directory, name)
    let journal: { version?: number; id?: string; phase?: string; writes?: Array<{ path: string; content: string }>; deletes?: string[] }
    try { journal = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error(`Invalid atomic bundle journal: ${file}`) }
    if (journal.version !== 1 || typeof journal.id !== 'string' || !Array.isArray(journal.writes) || !Array.isArray(journal.deletes)) throw new Error(`Invalid atomic bundle journal schema: ${file}`)
    for (const item of journal.writes) atomicWrite(authorityPath(root, item.path), item.content)
    for (const item of journal.deletes) rmSync(authorityPath(root, item), { recursive: true, force: true })
    unlinkSync(file)
  }
}

export function withAtomicBundle<T>(root: string, logicalId: string, callback: (bundle: AtomicBundleView) => T, options: { fault?: (phase: BundleFaultPhase) => void } = {}): T {
  if (!/^[a-zA-Z0-9._-]+$/.test(logicalId)) throw new Error('Invalid atomic bundle logical id')
  const directory = join(root, '.ash-bundles'); const coordinator = join(directory, 'authority')
  const release = acquire(coordinator)
  try {
    recoverAuthorityUnlocked(root, directory)
    const writes = new Map<string, string>(); const deletes = new Set<string>()
    const view: AtomicBundleView = {
      read(logicalPath) { const absolute = authorityPath(root, logicalPath); if (writes.has(logicalPath)) return writes.get(logicalPath); if (deletes.has(logicalPath) || !existsSync(absolute)) return undefined; return readFileSync(absolute, 'utf8') },
      write(logicalPath, content) { authorityPath(root, logicalPath); writes.set(logicalPath, content); deletes.delete(logicalPath) },
      delete(logicalPath) { authorityPath(root, logicalPath); writes.delete(logicalPath); deletes.add(logicalPath) },
    }
    const result = callback(view)
    if (!writes.size && !deletes.size) return result
    const journal = { version: 1, id: logicalId, phase: 'applying', writes: [...writes].map(([path, content]) => ({ path, content })), deletes: [...deletes] }
    const file = join(directory, `${logicalId}.journal.json`); atomicWrite(file, JSON.stringify(journal, null, 2)); options.fault?.('journaled')
    let index = 0
    for (const item of journal.writes) { atomicWrite(authorityPath(root, item.path), item.content); if (index++ === 0) options.fault?.('after-first-write') }
    for (const item of journal.deletes) rmSync(authorityPath(root, item), { recursive: true, force: true })
    unlinkSync(file); options.fault?.('committed')
    return result
  } finally { release() }
}

export function recoverAtomicBundleAuthority(root: string): void {
  const directory = join(root, '.ash-bundles'); const release = acquire(join(directory, 'authority'))
  try { recoverAuthorityUnlocked(root, directory) } finally { release() }
}

export function createAtomicBundleResource(initialRoot: string) {
  let root = initialRoot
  recoverAtomicBundleAuthority(root)
  return {
    checkpoint() { recoverAtomicBundleAuthority(root) },
    close() {},
    integrityCheck() { try { recoverAtomicBundleAuthority(root); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
    reopen(nextRoot: string) { root = nextRoot; recoverAtomicBundleAuthority(root) },
  }
}
