import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type BundleFaultPhase = 'locked' | 'journaled' | 'after-first-write' | 'committed'
interface BundleJournal { id: string; phase: 'applying' | 'committed'; writes: Array<{ path: string; content: string }>; deletes: string[] }
export interface AtomicBundleOptions { coordinatorPath: string; writes: Map<string, string>; deletes?: string[]; fault?: (phase: BundleFaultPhase) => void }

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
