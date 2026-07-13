import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireStorageFileLock } from './file-lock'
import { durableAtomicWrite, durableMkdir, durableRecursiveCopy, durableRemove, durableRename } from './durable-atomic'

interface ExtensionTransactionOptions { extensionsRoot: string; destination: string; fault?: (phase: string) => void }
interface InstallOptions extends ExtensionTransactionOptions { source: string; validate?: (stagedPath: string) => void; registryWrites?: Map<string, string> }
interface ExtensionJournal {
  version: 1
  id: string; kind: 'install' | 'uninstall' | 'file'; phase: 'staged' | 'backed-up' | 'package-committed' | 'awaiting-snapshot' | 'completed'
  snapshotRequired?: true
  snapshotDecision?: 'pending' | 'keep' | 'rollback'
  destination: string; stagingPath?: string; backupPath?: string; content?: string
  registryWrites: Array<{ path: string; content: string }>; registryDeletes: string[]
}

const transactionsDir = (root: string) => join(root, '.ash-transactions')
const journalPath = (root: string, id: string) => join(transactionsDir(root), `${id}.json`)
const lockPath = (root: string) => join(root, '.ash', 'extension-transactions.lock')
const activeInstallReceipts = new WeakSet<object>()
const rolledBackInstallReceipts = new WeakSet<object>()

function atomicWrite(path: string, content: string): void {
  durableAtomicWrite(path, content)
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
  rejectPathLinks(root, absolute)
  return absolute
}
function rejectPathLinks(root: string, target: string): void {
  const absoluteRoot = resolve(root); const rel = relative(absoluteRoot, resolve(target)); let current = absoluteRoot
  for (const segment of ['', ...rel.split(sep)]) {
    if (segment) current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Extension path contains a symbolic link or reparse point: ${current}`)
  }
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
  if (stored.version !== 1 || typeof stored.id !== 'string' || basename(file) !== `${stored.id}.json` || !['install', 'uninstall', 'file'].includes(String(stored.kind)) || !['staged', 'backed-up', 'package-committed', 'awaiting-snapshot', 'completed'].includes(String(stored.phase))) throw new Error(`Invalid extension transaction journal schema: ${file}`)
  const phase = stored.phase as ExtensionJournal['phase']
  const decision = stored.snapshotDecision
  const snapshotRequired = stored.snapshotRequired
  if (snapshotRequired !== undefined && (snapshotRequired !== true || stored.kind !== 'install')) throw new Error(`Invalid extension transaction snapshot mode: ${file}`)
  const validSnapshotState = phase === 'awaiting-snapshot'
    ? snapshotRequired === true && decision === 'pending'
    : phase === 'completed'
      ? decision === undefined || (stored.kind === 'install' && ['keep', 'rollback'].includes(String(decision)))
      : decision === undefined
  if (!validSnapshotState) throw new Error(`Invalid extension transaction snapshot state: ${file}`)
  const writes = Array.isArray(stored.registryWrites) ? stored.registryWrites : []
  const deletes = Array.isArray(stored.registryDeletes) ? stored.registryDeletes : []
  return {
    version: 1, id: stored.id, kind: stored.kind as ExtensionJournal['kind'], phase,
    snapshotRequired: snapshotRequired as ExtensionJournal['snapshotRequired'],
    snapshotDecision: decision as ExtensionJournal['snapshotDecision'],
    destination: fromRelative(root, stored.destination),
    stagingPath: stored.stagingPath === undefined ? undefined : fromRelative(root, stored.stagingPath),
    backupPath: stored.backupPath === undefined ? undefined : fromRelative(root, stored.backupPath),
    content: typeof stored.content === 'string' ? stored.content : undefined,
    registryWrites: writes.map((item) => { const value = item as Record<string, unknown>; if (typeof value.content !== 'string') throw new Error('Invalid extension registry journal entry'); return { path: fromRelative(root, value.path), content: value.content } }),
    registryDeletes: deletes.map((item) => fromRelative(root, item)),
  }
}

function acquire(root: string): () => void {
  const path = lockPath(root); durableMkdir(dirname(path))
  return acquireStorageFileLock(path)
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
  rejectPathLinks(options.extensionsRoot, options.destination)
}

function isSameOrChild(parent: string, candidate: string): boolean {
  const value = relative(resolve(parent), resolve(candidate))
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}

function assertDisjointTransactionPaths(destination: string, registryPaths: Iterable<string>): void {
  const paths = [...registryPaths]
  for (const path of paths) {
    if (isSameOrChild(destination, path) || isSameOrChild(path, destination)) throw new Error('Extension package and registry paths must not overlap')
  }
  for (let index = 0; index < paths.length; index += 1) {
    for (let other = index + 1; other < paths.length; other += 1) {
      if (isSameOrChild(paths[index], paths[other]) || isSameOrChild(paths[other], paths[index])) throw new Error('Extension registry paths must not overlap')
    }
  }
}

function rejectLinks(path: string): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error(`Extension package contains a symbolic link: ${path}`)
  if (stat.isDirectory()) for (const entry of readdirSync(path)) rejectLinks(join(path, entry))
}

function applyRegistry(root: string, journal: ExtensionJournal): void {
  assertDisjointTransactionPaths(journal.destination, [...journal.registryWrites.map((item) => item.path), ...journal.registryDeletes])
  for (const item of journal.registryWrites) {
    assertDestination({ extensionsRoot: root, destination: item.path })
    if (existsSync(item.path)) {
      const backup = join(root, '.ash-backups', journal.id, 'registry', relative(root, item.path)); rejectPathLinks(root, backup); if (!existsSync(backup)) durableRecursiveCopy(item.path, backup)
    }
    atomicWrite(item.path, item.content)
  }
  for (const path of journal.registryDeletes) {
    assertDestination({ extensionsRoot: root, destination: path })
    if (!existsSync(path)) continue
    const backup = join(root, '.ash-backups', journal.id, 'registry', relative(root, path)); rejectPathLinks(root, backup); durableMkdir(dirname(backup)); if (!existsSync(backup)) durableRename(path, backup); else durableRemove(path)
  }
}

function finish(root: string, journal: ExtensionJournal, fault?: (phase: string) => void, awaitSnapshot = false): void {
  if (journal.phase === 'package-committed' && journal.kind === 'install' && !existsSync(journal.destination)) {
    if (journal.stagingPath && existsSync(journal.stagingPath)) durableRename(journal.stagingPath, journal.destination)
    else if (journal.backupPath && existsSync(journal.backupPath)) { durableRename(journal.backupPath, journal.destination); journal.phase = 'completed'; persist(root, journal) }
    else throw new Error('Extension committed package and recovery payload are both missing')
  }
  if (journal.phase === 'staged') {
    if (existsSync(journal.destination)) { if (!journal.backupPath) throw new Error('Missing extension backup path'); durableMkdir(dirname(journal.backupPath)); if (!existsSync(journal.backupPath)) durableRename(journal.destination, journal.backupPath) }
    journal.phase = 'backed-up'; persist(root, journal); fault?.('after-backup')
  }
  if (journal.phase === 'backed-up') {
    if (journal.kind === 'install') {
      if (!journal.stagingPath || !existsSync(journal.stagingPath)) throw new Error('Extension staging payload is unavailable during recovery')
      durableMkdir(dirname(journal.destination)); if (!existsSync(journal.destination)) durableRename(journal.stagingPath, journal.destination)
    } else if (journal.kind === 'file') {
      atomicWrite(journal.destination, journal.content ?? '')
    }
    journal.phase = 'package-committed'; persist(root, journal); fault?.('after-package-commit')
  }
  if (journal.phase === 'package-committed') {
    applyRegistry(root, journal)
    if (awaitSnapshot) {
      journal.phase = 'awaiting-snapshot'; journal.snapshotDecision = 'pending'; persist(root, journal); fault?.('awaiting-snapshot')
    } else {
      journal.phase = 'completed'; persist(root, journal); fault?.('after-registry-commit')
    }
  }
  if (journal.phase === 'completed') { if (journal.stagingPath) durableRemove(dirname(journal.stagingPath)); durableRemove(journalPath(root, journal.id)) }
}

function recoverUnlocked(root: string): void {
  if (!existsSync(transactionsDir(root))) return
  for (const file of readdirSync(transactionsDir(root)).filter((name) => name.endsWith('.json')).sort()) {
    const journal = readJournal(root, join(transactionsDir(root), file))
    if (journal.phase === 'awaiting-snapshot') rollbackPendingSnapshot(root, journal)
    else if (journal.snapshotRequired) {
      finish(root, journal, undefined, true)
      if (journal.snapshotDecision === 'pending') rollbackPendingSnapshot(root, journal)
    } else finish(root, journal)
  }
}
export function recoverExtensionTransactions(extensionsRoot: string): void { const release = acquire(extensionsRoot); try { recoverUnlocked(extensionsRoot) } finally { release() } }

export interface CompletedExtensionInstall {
  readonly extensionsRoot: string
  readonly destination: string
  readonly transactionId: string
  readonly stagingPath: string
  readonly backupPath?: string
  readonly registryPaths: readonly string[]
}

function validateInstallOptions(options: InstallOptions): void {
  assertDestination(options); rejectLinks(options.source)
  for (const path of options.registryWrites?.keys() ?? []) assertDestination({ extensionsRoot: options.extensionsRoot, destination: path })
  assertDisjointTransactionPaths(options.destination, options.registryWrites?.keys() ?? [])
}

function installDirectoryUnlocked(options: InstallOptions, awaitSnapshot = false): CompletedExtensionInstall {
    options.fault?.('locked'); recoverUnlocked(options.extensionsRoot)
    for (const path of options.registryWrites?.keys() ?? []) assertDestination({ extensionsRoot: options.extensionsRoot, destination: path })
    assertDisjointTransactionPaths(options.destination, options.registryWrites?.keys() ?? [])
    const id = randomUUID(); const stagingPath = join(options.extensionsRoot, '.ash-staging', id, 'payload')
    try { durableRecursiveCopy(options.source, stagingPath, { filter: (source) => !['node_modules', '.git'].includes(basename(source)), afterCopy: () => options.fault?.('copy-entry') }); options.validate?.(stagingPath) }
    catch (error) { durableRemove(dirname(stagingPath)); throw error }
    const backupPath = existsSync(options.destination) ? join(options.extensionsRoot, '.ash-backups', id, relative(options.extensionsRoot, options.destination)) : undefined
    const journal: ExtensionJournal = { version: 1, id, kind: 'install', phase: 'staged', snapshotRequired: awaitSnapshot ? true : undefined, destination: options.destination, stagingPath, backupPath, registryWrites: [...(options.registryWrites ?? new Map())].map(([path, content]) => ({ path, content })), registryDeletes: [] }
    persist(options.extensionsRoot, journal); options.fault?.('journaled'); finish(options.extensionsRoot, journal, options.fault, awaitSnapshot)
    return Object.freeze({ extensionsRoot: options.extensionsRoot, destination: options.destination, transactionId: id, stagingPath, backupPath, registryPaths: Object.freeze([...(options.registryWrites?.keys() ?? [])]) })
}

export function transactionalInstallDirectory(options: InstallOptions): CompletedExtensionInstall {
  validateInstallOptions(options); const release = acquire(options.extensionsRoot)
  try {
    return installDirectoryUnlocked(options)
  } finally { release() }
}

function rollbackInstallState(options: CompletedExtensionInstall): void {
  assertDestination(options)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(options.transactionId)) throw new Error('Invalid extension transaction identifier')
  for (const path of options.registryPaths) assertDestination({ extensionsRoot: options.extensionsRoot, destination: path })
  assertDisjointTransactionPaths(options.destination, options.registryPaths)
  const backupRoot = join(options.extensionsRoot, '.ash-backups', options.transactionId)
  const packageRelative = relative(options.extensionsRoot, options.destination)
  const packageBackup = join(backupRoot, packageRelative)
  const failedPackage = join(backupRoot, '.failed-install', packageRelative)
  const registries = options.registryPaths.map((path) => {
    const value = relative(options.extensionsRoot, path)
    return { path, backup: join(backupRoot, 'registry', value), failed: join(backupRoot, '.failed-registry', value) }
  })
  for (const path of [backupRoot, packageBackup, failedPackage, ...registries.flatMap((item) => [item.path, item.backup, item.failed])]) rejectPathLinks(options.extensionsRoot, path)

  if (!existsSync(failedPackage) && existsSync(options.destination)) {
    durableMkdir(dirname(failedPackage)); durableRename(options.destination, failedPackage)
  }
  for (const item of registries) {
    if (!existsSync(item.failed) && existsSync(item.path)) { durableMkdir(dirname(item.failed)); durableRename(item.path, item.failed) }
    if (existsSync(item.backup)) {
      if (existsSync(item.path)) throw new Error('Extension registry rollback destination is occupied')
      durableMkdir(dirname(item.path)); durableRename(item.backup, item.path)
    }
  }
  if (existsSync(packageBackup)) {
    if (existsSync(options.destination)) throw new Error('Extension package rollback destination is occupied')
    durableMkdir(dirname(options.destination)); durableRename(packageBackup, options.destination)
  }
}

function receiptFromJournal(root: string, journal: ExtensionJournal): CompletedExtensionInstall {
  if (journal.kind !== 'install' || !journal.stagingPath) throw new Error('Invalid pending extension snapshot journal')
  return {
    extensionsRoot: root,
    destination: journal.destination,
    transactionId: journal.id,
    stagingPath: journal.stagingPath,
    backupPath: journal.backupPath,
    registryPaths: journal.registryWrites.map((item) => item.path),
  }
}

function rollbackPendingSnapshot(root: string, journal: ExtensionJournal): void {
  if (journal.phase !== 'awaiting-snapshot' || journal.snapshotDecision !== 'pending') throw new Error('Extension snapshot journal is not pending')
  rollbackInstallState(receiptFromJournal(root, journal))
  journal.phase = 'completed'; journal.snapshotDecision = 'rollback'; persist(root, journal); finish(root, journal)
}

function pendingJournalForReceipt(receipt: CompletedExtensionInstall): ExtensionJournal {
  const file = journalPath(receipt.extensionsRoot, receipt.transactionId)
  if (!existsSync(file)) throw new Error('Extension install lease journal is unavailable')
  const journal = readJournal(receipt.extensionsRoot, file)
  const pathsMatch = journal.registryWrites.length === receipt.registryPaths.length && journal.registryWrites.every((item, index) => resolve(item.path) === resolve(receipt.registryPaths[index]))
  if (journal.kind !== 'install' || journal.phase !== 'awaiting-snapshot' || journal.snapshotDecision !== 'pending' || resolve(journal.destination) !== resolve(receipt.destination) || resolve(journal.stagingPath ?? '') !== resolve(receipt.stagingPath) || (journal.backupPath === undefined) !== (receipt.backupPath === undefined) || (journal.backupPath && receipt.backupPath && resolve(journal.backupPath) !== resolve(receipt.backupPath)) || !pathsMatch) throw new Error('Extension install lease does not match its durable journal')
  return journal
}

function rollbackCompletedExtensionInstallUnlocked(options: CompletedExtensionInstall): void {
  const journal = pendingJournalForReceipt(options)
  rollbackPendingSnapshot(options.extensionsRoot, journal)
}

function keepCompletedExtensionInstallUnlocked(options: CompletedExtensionInstall): void {
  const journal = pendingJournalForReceipt(options)
  journal.phase = 'completed'; journal.snapshotDecision = 'keep'; persist(options.extensionsRoot, journal); finish(options.extensionsRoot, journal)
}

export function rollbackCompletedExtensionInstall(receipt: CompletedExtensionInstall): void {
  if (!activeInstallReceipts.has(receipt)) throw new Error('Completed extension install rollback requires an active issued lease receipt')
  if (rolledBackInstallReceipts.has(receipt)) return
  rollbackCompletedExtensionInstallUnlocked(receipt)
  rolledBackInstallReceipts.add(receipt)
}

export async function withLeasedExtensionInstall<T>(options: InstallOptions, decide: (receipt: CompletedExtensionInstall) => Promise<T>): Promise<T> {
  validateInstallOptions(options); const release = acquire(options.extensionsRoot)
  let receipt: CompletedExtensionInstall | undefined
  try {
    receipt = installDirectoryUnlocked(options, true); activeInstallReceipts.add(receipt)
    let result: T
    try { result = await decide(receipt) } catch (error) { rollbackCompletedExtensionInstall(receipt); throw error }
    options.fault?.('after-snapshot-publish')
    keepCompletedExtensionInstallUnlocked(receipt)
    return result
  } finally {
    if (receipt) activeInstallReceipts.delete(receipt)
    release()
  }
}

export function transactionalUninstallDirectory(options: ExtensionTransactionOptions & { registryDeletes?: string[] }): string | undefined {
  assertDestination(options); for (const path of options.registryDeletes ?? []) assertDestination({ extensionsRoot: options.extensionsRoot, destination: path }); assertDisjointTransactionPaths(options.destination, options.registryDeletes ?? []); const release = acquire(options.extensionsRoot)
  try {
    recoverUnlocked(options.extensionsRoot); for (const path of options.registryDeletes ?? []) assertDestination({ extensionsRoot: options.extensionsRoot, destination: path }); assertDisjointTransactionPaths(options.destination, options.registryDeletes ?? []); if (!existsSync(options.destination) && !(options.registryDeletes ?? []).some(existsSync)) return undefined
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
