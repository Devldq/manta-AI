import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

interface ExtensionTransactionOptions { extensionsRoot: string; destination: string; fault?: (phase: string) => void }
interface InstallOptions extends ExtensionTransactionOptions { source: string; validate?: (stagedPath: string) => void; registryWrites?: Map<string, string> }
interface ExtensionJournal {
  version: 1
  id: string; kind: 'install' | 'uninstall' | 'file'; phase: 'staged' | 'backed-up' | 'package-committed' | 'completed'
  destination: string; stagingPath?: string; backupPath?: string; content?: string
  registryWrites: Array<{ path: string; content: string }>; registryDeletes: string[]
}

const transactionsDir = (root: string) => join(root, '.ash-transactions')
const journalPath = (root: string, id: string) => join(transactionsDir(root), `${id}.json`)
const lockPath = (root: string) => join(root, '.ash', 'extension-transactions.lock')

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx')
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
}
function toRelative(root: string, absolutePath: string): string {
  const value = relative(resolve(root), resolve(absolutePath))
  if (!value || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value)) throw new Error('Extension journal path must be a child of its volume root')
  return value.split(sep).join('/')
}
function fromRelative(root: string, value: unknown): string {
  if (typeof value !== 'string' || !value || isAbsolute(value)) throw new Error('Invalid extension journal path')
  const absolute = resolve(root, value)
  toRelative(root, absolute)
  return absolute
}
function persist(root: string, journal: ExtensionJournal): void {
  const stored = {
    ...journal,
    destination: toRelative(root, journal.destination),
    stagingPath: journal.stagingPath ? toRelative(root, journal.stagingPath) : undefined,
    backupPath: journal.backupPath ? toRelative(root, journal.backupPath) : undefined,
    registryWrites: journal.registryWrites.map((item) => ({ ...item, path: toRelative(root, item.path) })),
    registryDeletes: journal.registryDeletes.map((item) => toRelative(root, item)),
  }
  atomicWrite(journalPath(root, journal.id), JSON.stringify(stored, null, 2))
}

function readJournal(root: string, file: string): ExtensionJournal {
  let stored: Record<string, unknown>
  try { stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> } catch { throw new Error(`Invalid extension transaction journal: ${file}`) }
  if (stored.version !== 1 || typeof stored.id !== 'string' || basename(file) !== `${stored.id}.json` || !['install', 'uninstall', 'file'].includes(String(stored.kind)) || !['staged', 'backed-up', 'package-committed', 'completed'].includes(String(stored.phase))) throw new Error(`Invalid extension transaction journal schema: ${file}`)
  const writes = Array.isArray(stored.registryWrites) ? stored.registryWrites : []
  const deletes = Array.isArray(stored.registryDeletes) ? stored.registryDeletes : []
  return {
    version: 1, id: stored.id, kind: stored.kind as ExtensionJournal['kind'], phase: stored.phase as ExtensionJournal['phase'],
    destination: fromRelative(root, stored.destination),
    stagingPath: stored.stagingPath === undefined ? undefined : fromRelative(root, stored.stagingPath),
    backupPath: stored.backupPath === undefined ? undefined : fromRelative(root, stored.backupPath),
    content: typeof stored.content === 'string' ? stored.content : undefined,
    registryWrites: writes.map((item) => { const value = item as Record<string, unknown>; if (typeof value.content !== 'string') throw new Error('Invalid extension registry journal entry'); return { path: fromRelative(root, value.path), content: value.content } }),
    registryDeletes: deletes.map((item) => fromRelative(root, item)),
  }
}

function acquire(root: string): () => void {
  const path = lockPath(root); mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    let stale = false
    try { const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number }; if (Number.isInteger(owner.pid)) { try { process.kill(owner.pid!, 0) } catch { stale = true } } } catch { /* fail closed */ }
    if (stale) unlinkSync(path)
  }
  let fd: number
  try { fd = openSync(path, 'wx') } catch (error) { throw new Error('Extension transaction lock is already held', { cause: error }) }
  const token = randomUUID(); writeFileSync(fd, JSON.stringify({ token, pid: process.pid })); fsyncSync(fd)
  return () => { closeSync(fd); try { const owner = JSON.parse(readFileSync(path, 'utf8')) as { token?: string }; if (owner.token === token) unlinkSync(path) } catch { /* ownership changed */ } }
}

function assertDestination(options: ExtensionTransactionOptions): void {
  if (!isAbsolute(options.extensionsRoot) || !isAbsolute(options.destination)) throw new Error('Extension transaction paths must be absolute')
  const rel = relative(resolve(options.extensionsRoot), resolve(options.destination))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Extension destination must be a child of the ASH extensions root')
  if (existsSync(options.extensionsRoot)) {
    const realRoot = realpathSync(options.extensionsRoot); let ancestor = options.destination
    while (!existsSync(ancestor)) { const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent }
    const realRelative = relative(realRoot, realpathSync(ancestor))
    if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw new Error('Extension destination resolves outside the ASH extensions root')
  }
}

function rejectLinks(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`Extension package contains a symbolic link: ${path}`)
  if (stat.isDirectory()) for (const entry of readdirSync(path)) rejectLinks(join(path, entry))
}

function applyRegistry(root: string, journal: ExtensionJournal): void {
  for (const item of journal.registryWrites) {
    if (existsSync(item.path)) {
      const backup = join(root, '.ash-backups', journal.id, 'registry', relative(root, item.path)); if (!existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); cpSync(item.path, backup) }
    }
    atomicWrite(item.path, item.content)
  }
  for (const path of journal.registryDeletes) {
    if (!existsSync(path)) continue
    const backup = join(root, '.ash-backups', journal.id, 'registry', relative(root, path)); mkdirSync(dirname(backup), { recursive: true }); if (!existsSync(backup)) renameSync(path, backup); else rmSync(path, { force: true })
  }
}

function finish(root: string, journal: ExtensionJournal, fault?: (phase: string) => void): void {
  if (journal.phase === 'staged') {
    if (existsSync(journal.destination)) { if (!journal.backupPath) throw new Error('Missing extension backup path'); mkdirSync(dirname(journal.backupPath), { recursive: true }); if (!existsSync(journal.backupPath)) renameSync(journal.destination, journal.backupPath) }
    journal.phase = 'backed-up'; persist(root, journal); fault?.('after-backup')
  }
  if (journal.phase === 'backed-up') {
    if (journal.kind === 'install') {
      if (!journal.stagingPath || !existsSync(journal.stagingPath)) throw new Error('Extension staging payload is unavailable during recovery')
      mkdirSync(dirname(journal.destination), { recursive: true }); if (!existsSync(journal.destination)) renameSync(journal.stagingPath, journal.destination)
    } else if (journal.kind === 'file') {
      atomicWrite(journal.destination, journal.content ?? '')
    }
    journal.phase = 'package-committed'; persist(root, journal); fault?.('after-package-commit')
  }
  if (journal.phase === 'package-committed') { applyRegistry(root, journal); journal.phase = 'completed'; persist(root, journal); fault?.('after-registry-commit') }
  if (journal.phase === 'completed') { if (journal.stagingPath) rmSync(dirname(journal.stagingPath), { recursive: true, force: true }); unlinkSync(journalPath(root, journal.id)) }
}

function recoverUnlocked(root: string): void {
  if (!existsSync(transactionsDir(root))) return
  for (const file of readdirSync(transactionsDir(root)).filter((name) => name.endsWith('.json')).sort()) finish(root, readJournal(root, join(transactionsDir(root), file)))
}
export function recoverExtensionTransactions(extensionsRoot: string): void { const release = acquire(extensionsRoot); try { recoverUnlocked(extensionsRoot) } finally { release() } }

export function transactionalInstallDirectory(options: InstallOptions): { transactionId: string; stagingPath: string; backupPath?: string } {
  assertDestination(options); rejectLinks(options.source); const release = acquire(options.extensionsRoot)
  try {
    options.fault?.('locked'); recoverUnlocked(options.extensionsRoot); const id = randomUUID(); const stagingPath = join(options.extensionsRoot, '.ash-staging', id, 'payload')
    mkdirSync(dirname(stagingPath), { recursive: true }); cpSync(options.source, stagingPath, { recursive: true, dereference: false, filter: (source) => !['node_modules', '.git'].includes(basename(source)) }); options.validate?.(stagingPath)
    const backupPath = existsSync(options.destination) ? join(options.extensionsRoot, '.ash-backups', id, relative(options.extensionsRoot, options.destination)) : undefined
    const journal: ExtensionJournal = { version: 1, id, kind: 'install', phase: 'staged', destination: options.destination, stagingPath, backupPath, registryWrites: [...(options.registryWrites ?? new Map())].map(([path, content]) => ({ path, content })), registryDeletes: [] }
    persist(options.extensionsRoot, journal); options.fault?.('journaled'); finish(options.extensionsRoot, journal, options.fault); return { transactionId: id, stagingPath, backupPath }
  } finally { release() }
}

export function transactionalUninstallDirectory(options: ExtensionTransactionOptions & { registryDeletes?: string[] }): string | undefined {
  assertDestination(options); const release = acquire(options.extensionsRoot)
  try {
    recoverUnlocked(options.extensionsRoot); if (!existsSync(options.destination) && !(options.registryDeletes ?? []).some(existsSync)) return undefined
    const id = randomUUID(); const backupPath = existsSync(options.destination) ? join(options.extensionsRoot, '.ash-backups', id, relative(options.extensionsRoot, options.destination)) : undefined
    const journal: ExtensionJournal = { version: 1, id, kind: 'uninstall', phase: 'staged', destination: options.destination, backupPath, registryWrites: [], registryDeletes: options.registryDeletes ?? [] }
    persist(options.extensionsRoot, journal); finish(options.extensionsRoot, journal, options.fault); return backupPath
  } finally { release() }
}

export function transactionalWriteExtensionFile(options: ExtensionTransactionOptions & { content: string }): { backupPath?: string } {
  assertDestination(options); const release = acquire(options.extensionsRoot)
  try {
    recoverUnlocked(options.extensionsRoot); const id = randomUUID(); const backupPath = existsSync(options.destination) ? join(options.extensionsRoot, '.ash-backups', id, relative(options.extensionsRoot, options.destination)) : undefined
    const journal: ExtensionJournal = { version: 1, id, kind: 'file', phase: 'staged', destination: options.destination, backupPath, content: options.content, registryWrites: [], registryDeletes: [] }
    persist(options.extensionsRoot, journal); finish(options.extensionsRoot, journal, options.fault); return { backupPath }
  } finally { release() }
}
