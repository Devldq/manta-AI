import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { acquireStorageFileLock } from './file-lock'
import { durableAtomicWrite, durableCopy, durableRemove, durableRename } from './durable-atomic'

export interface CrossGroupParticipant { name: string; root: string }
export type CrossGroupFaultPhase = 'after-first-prepare' | 'after-prepare' | 'after-first-apply' | 'after-apply' | 'after-first-commit'
interface Change { path: string; content?: string; delete?: true; hash?: string }
interface CommittedState { version: 1; id: string; generation: number; phase: 'committed'; txId: string; targets: Record<string, { present: true; hash: string } | { absent: true }> }
interface PreparedState { version: 1; id: string; generation: number; phase: 'prepared'; txId: string; changes: Change[]; previous?: CommittedState }
type State = CommittedState | PreparedState

export interface CrossGroupJournalInspection { id: string; phase: 'prepared' | 'committed' }

const stateDir = (root: string) => join(root, '.ash-2pc')
const statePath = (root: string, id: string) => join(stateDir(root), `${id}.json`)
const hash = (content: string) => createHash('sha256').update(content).digest('hex')

function assertId(value: string): void { if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Invalid cross-group transaction id') }
function contained(root: string, logical: string): string {
  if (!logical || isAbsolute(logical)) throw new Error('Cross-group path must be root-relative')
  const absoluteRoot = resolve(root); const target = resolve(root, logical); const rel = relative(absoluteRoot, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Cross-group path escapes its participant root')
  let current = absoluteRoot
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Participant root must not be a symbolic link or reparse point')
  for (const segment of rel.split(sep)) {
    current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Cross-group path contains a symbolic link or reparse point')
  }
  return target
}
function atomicWrite(file: string, content: string): void {
  contained(dirname(file), `./${file.slice(dirname(file).length + 1)}`)
  durableAtomicWrite(file, content)
}
function acquire(root: string): () => void {
  contained(root, '.ash-2pc'); mkdirSync(stateDir(root), { recursive: true }); contained(root, '.ash-2pc'); return acquireStorageFileLock(join(stateDir(root), 'global.lock'))
}
function load(root: string, id: string): State | undefined {
  const file = statePath(root, id); if (!existsSync(file)) return undefined
  const state = JSON.parse(readFileSync(file, 'utf8')) as State
  if (state.version !== 1 || state.id !== id || !Number.isInteger(state.generation) || !['prepared', 'committed'].includes(state.phase)) throw new Error('Invalid cross-group journal schema')
  if (state.phase === 'prepared') for (const item of state.changes) contained(root, item.path)
  return state
}

/** Strict, read-only journal inspection for GC safety checks. */
export function inspectCrossGroupJournals(root: string): CrossGroupJournalInspection[] {
  const directory = stateDir(root); if (!existsSync(directory)) return []
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const id = name.slice(0, -5); assertId(id); const state = load(root, id)
    if (!state) throw new Error('Cross-group journal disappeared during inspection')
    return { id: state.id, phase: state.phase }
  })
}
function persist(root: string, state: State): void { atomicWrite(statePath(root, state.id), JSON.stringify(state, null, 2)) }
function apply(root: string, state: PreparedState): void {
  for (const change of state.changes) {
    const target = contained(root, change.path)
    if (change.delete) rmSync(target, { recursive: true, force: true })
    else atomicWrite(target, change.content ?? '')
  }
}
function committed(state: PreparedState): CommittedState {
  return { version: 1, id: state.id, generation: state.generation, phase: 'committed', txId: state.txId, targets: { ...(state.previous?.targets ?? {}), ...Object.fromEntries(state.changes.map((item) => [item.path, item.delete ? { absent: true } : { present: true, hash: item.hash! }])) } }
}
function recoverLocked(participants: CrossGroupParticipant[], id: string): State[] {
  const states = participants.map((participant) => load(participant.root, id))
  const prepared = states.map((state, index) => ({ state, index })).filter((item): item is { state: PreparedState; index: number } => item.state?.phase === 'prepared')
  if (prepared.length) {
    const txIds = new Set(prepared.map((item) => item.state.txId)); const generations = new Set(prepared.map((item) => item.state.generation))
    const matchingCommitted = states.filter((state): state is CommittedState => state?.phase === 'committed' && txIds.has(state.txId) && generations.has(state.generation))
    if (txIds.size !== 1 || generations.size !== 1) throw new Error('Cross-group prepared transaction conflict')
    if (prepared.length === participants.length || matchingCommitted.length) {
      for (const item of prepared) apply(participants[item.index].root, item.state)
      for (const item of prepared) persist(participants[item.index].root, committed(item.state))
    } else {
      for (const item of prepared) item.state.previous ? persist(participants[item.index].root, item.state.previous) : rmSync(statePath(participants[item.index].root, id), { force: true })
    }
  }
  const recovered = participants.map((participant) => load(participant.root, id)).filter((state): state is State => Boolean(state))
  if (recovered.length && (recovered.length !== participants.length || recovered.some((state) => state.phase !== 'committed' || state.generation !== recovered[0].generation || state.txId !== recovered[0].txId || state.id !== recovered[0].id))) throw new Error('Cross-group transaction generations cannot be reconciled')
  recovered.forEach((state, index) => {
    if (state.phase !== 'committed') return
    for (const [logical, expected] of Object.entries(state.targets)) {
      const target = contained(participants[index].root, logical)
      if ('absent' in expected) { if (existsSync(target)) throw new Error('Cross-group committed tombstone conflict'); continue }
      if (!existsSync(target) || hash(readFileSync(target, 'utf8')) !== expected.hash) throw new Error('Cross-group committed payload hash mismatch')
    }
  })
  return recovered
}
function locked<T>(participants: CrossGroupParticipant[], operation: () => T): T {
  const ordered = [...participants].sort((a, b) => resolve(a.root).localeCompare(resolve(b.root))); const releases: Array<() => void> = []
  try { for (const participant of ordered) releases.push(acquire(participant.root)); return operation() } finally { for (const release of releases.reverse()) release() }
}

export interface CrossGroupView { read(participant: string, path: string): string | undefined }
export interface CrossGroupTransaction extends CrossGroupView { write(participant: string, path: string, content: string): void; delete(participant: string, path: string): void }

export function readCrossGroupBundle<T>(participants: CrossGroupParticipant[], id: string, reader: (view: CrossGroupView) => T): T | undefined {
  assertId(id); return locked(participants, () => {
    const states = recoverLocked(participants, id); if (!states.length) return undefined
    const byName = new Map(participants.map((participant) => [participant.name, participant]))
    return reader({ read(name, path) { const participant = byName.get(name); if (!participant) throw new Error(`Unknown participant: ${name}`); const target = contained(participant.root, path); return existsSync(target) ? readFileSync(target, 'utf8') : undefined } })
  })
}

export function transactCrossGroupBundle<T>(participants: CrossGroupParticipant[], id: string, callback: (transaction: CrossGroupTransaction) => T, options: { fault?: (phase: CrossGroupFaultPhase) => void } = {}): T {
  assertId(id); if (new Set(participants.map((item) => item.name)).size !== participants.length) throw new Error('Duplicate cross-group participant')
  return locked(participants, () => {
    const previous = recoverLocked(participants, id); const generation = (previous[0]?.generation ?? 0) + 1; const txId = randomUUID(); const changes = new Map<string, Change[]>()
    const byName = new Map(participants.map((participant) => [participant.name, participant]))
    const transaction: CrossGroupTransaction = {
      read(name, path) { const participant = byName.get(name); if (!participant) throw new Error(`Unknown participant: ${name}`); const target = contained(participant.root, path); return existsSync(target) ? readFileSync(target, 'utf8') : undefined },
      write(name, path, content) { const participant = byName.get(name); if (!participant) throw new Error(`Unknown participant: ${name}`); contained(participant.root, path); const list = changes.get(name) ?? []; list.push({ path, content, hash: hash(content) }); changes.set(name, list) },
      delete(name, path) { const participant = byName.get(name); if (!participant) throw new Error(`Unknown participant: ${name}`); contained(participant.root, path); const list = changes.get(name) ?? []; list.push({ path, delete: true }); changes.set(name, list) },
    }
    const result = callback(transaction)
    const prepared = participants.map((participant, index): PreparedState => ({ version: 1, id, generation, phase: 'prepared', txId, changes: changes.get(participant.name) ?? [], previous: previous[index] as CommittedState | undefined }))
    persist(participants[0].root, prepared[0]); options.fault?.('after-first-prepare')
    for (let index = 1; index < participants.length; index++) persist(participants[index].root, prepared[index]); options.fault?.('after-prepare')
    apply(participants[0].root, prepared[0]); options.fault?.('after-first-apply')
    for (let index = 1; index < participants.length; index++) apply(participants[index].root, prepared[index]); options.fault?.('after-apply')
    persist(participants[0].root, committed(prepared[0])); options.fault?.('after-first-commit')
    for (let index = 1; index < participants.length; index++) persist(participants[index].root, committed(prepared[index]))
    return result
  })
}

function transactionIds(participants: CrossGroupParticipant[]): string[] {
  const ids = new Set<string>()
  for (const participant of participants) {
    const directory = stateDir(participant.root); if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) if (name.endsWith('.json')) ids.add(name.slice(0, -5))
  }
  return [...ids].sort()
}

export function createCrossGroupBundleResources(initial: CrossGroupParticipant[]) {
  const participants = initial.map((item) => ({ ...item })); let closed = false
  const recover = () => { if (closed) return; for (const id of transactionIds(participants)) locked(participants, () => { recoverLocked(participants, id) }) }
  recover()
  return Object.fromEntries(participants.map((participant) => [participant.name, {
    checkpoint: recover,
    close() { closed = true },
    integrityCheck() { try { recover(); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
    reopen(root: string) { participant.root = root; closed = false },
  }]))
}

/** One-time bridge for journals produced by the pre-2PC development build. */
export interface LegacyRecoveryWarning { time: string; code: 'LEGACY_JOURNAL_QUARANTINED'; journalId: string; reasonHash: string }
export function migrateLegacyAtomicJournals(legacyDirectory: string, currentRoots: string[], diagnosticsRoot: string): LegacyRecoveryWarning[] {
  const warnings: LegacyRecoveryWarning[] = []
  if (!existsSync(legacyDirectory)) return []
  for (const name of readdirSync(legacyDirectory).filter((entry) => entry.endsWith('.journal.json'))) {
    const file = join(legacyDirectory, name)
    try {
    const journal = JSON.parse(readFileSync(file, 'utf8')) as { writes?: Array<{ path?: string; content?: string }>; deletes?: string[] }
    if (!Array.isArray(journal.writes) || !Array.isArray(journal.deletes)) throw new Error('Invalid legacy atomic journal')
    const resolveLegacy = (target: unknown) => {
      if (typeof target !== 'string' || !isAbsolute(target)) throw new Error('Invalid legacy atomic journal path')
      const root = currentRoots.find((candidate) => { const rel = relative(resolve(candidate), resolve(target)); return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) })
      if (!root) throw new Error('Legacy atomic journal targets a non-current storage root')
      return contained(root, relative(root, target))
    }
    for (const item of journal.writes) { if (typeof item.content !== 'string') throw new Error('Invalid legacy atomic journal write'); atomicWrite(resolveLegacy(item.path), item.content) }
    for (const target of journal.deletes) rmSync(resolveLegacy(target), { recursive: true, force: true })
    durableRemove(file)
    } catch (error) {
      const quarantineRoot = join(dirname(legacyDirectory), '.transactions-quarantine'); mkdirSync(quarantineRoot, { recursive: true }); const journalId = createHash('sha256').update(name).digest('hex').slice(0, 16); const target = join(quarantineRoot, journalId)
      try { durableRename(file, target) } catch (renameError) { if ((renameError as NodeJS.ErrnoException).code !== 'EXDEV') throw renameError; durableCopy(file, target, { expectedHash: createHash('sha256').update(readFileSync(file)).digest('hex') }); durableRemove(file) }
      const warning: LegacyRecoveryWarning = { time: new Date().toISOString(), code: 'LEGACY_JOURNAL_QUARANTINED', journalId, reasonHash: createHash('sha256').update(String(error)).digest('hex') }; warnings.push(warning)
      try { durableAtomicWrite(join(diagnosticsRoot, `${warning.time.replace(/[:.]/g, '-')}-${journalId}.json`), JSON.stringify(warning)) } catch { /* diagnostics must never block startup */ }
    }
  }
  for (const name of readdirSync(legacyDirectory)) if (name.endsWith('.lock')) rmSync(join(legacyDirectory, name), { force: true })
  if (!readdirSync(legacyDirectory).length) rmSync(legacyDirectory, { recursive: true, force: true })
  return warnings
}
