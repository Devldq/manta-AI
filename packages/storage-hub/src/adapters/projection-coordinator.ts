import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeJsonAtomic } from '../bootstrap/atomic-json'
import { acquireMigrationFileLock } from '../migration/migration-lock'
import { AdapterRegistry } from './adapter-registry'
import type {
  AdapterBackupEntry,
  AdapterJournal,
  AdapterPlan,
  AdapterResult,
  AgentInstallation,
  ApprovedAdapterPlan,
  AssetSelection,
  ImportPlan,
  PreviewFileOperation,
  ProjectionPlan,
} from './types'

export type ProjectionFaultPoint = 'after-journal' | 'after-backup-entry' | 'before-apply' | 'after-applied-journal'

export class SimulatedAdapterCrash extends Error {
  constructor(readonly point: string) { super(`Simulated adapter crash: ${point}`); this.name = 'SimulatedAdapterCrash' }
}

export interface ProjectionCoordinatorOptions {
  readonly stateRoot: string
  readonly registry: AdapterRegistry
  readonly now?: () => Date
  readonly fault?: (point: ProjectionFaultPoint) => Promise<void>
}

const queues = new Map<string, Promise<void>>()
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const WRITE_KINDS = new Set(['create', 'modify', 'delete'])

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}

function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
function clone<T>(value: T): T { return structuredClone(value) }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) freeze(item)
    Object.freeze(value)
  }
  return value
}
function planPayload(plan: AdapterPlan): unknown {
  const base = { schemaVersion: plan.schemaVersion, kind: plan.kind, planId: plan.planId, adapterId: plan.adapterId, target: plan.target, operations: plan.operations, createdAt: plan.createdAt, expiresAt: plan.expiresAt }
  return plan.kind === 'projection' ? { ...base, selection: plan.selection } : base
}
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right) }
function normalized(path: string): string { const value = resolve(path); return process.platform === 'win32' ? value.toLowerCase() : value }
function contains(root: string, child: string): boolean { const rel = relative(normalized(root), normalized(child)); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) }
function safeRelative(value: string): boolean { return value.length > 0 && !isAbsolute(value) && !value.includes('\0') && value.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..') }
function expectedKeys(value: object, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key)); if (extra.length) throw new Error(`${label} contains unsupported fields: ${extra.join(', ')}`)
}
async function statOrAbsent(path: string) { try { return await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } }

async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve(); let release!: () => void; const current = new Promise<void>((resolvePromise) => { release = resolvePromise }); const tail = previous.then(() => current); queues.set(key, tail)
  await previous
  try { return await operation() } finally { release(); if (queues.get(key) === tail) queues.delete(key) }
}

export class ProjectionCoordinator {
  readonly #stateRoot: string
  readonly #registry: AdapterRegistry
  readonly #now: () => Date
  readonly #fault?: ProjectionCoordinatorOptions['fault']

  constructor(options: ProjectionCoordinatorOptions) {
    if (!isAbsolute(options.stateRoot) || options.stateRoot.includes('\0')) throw new Error('Adapter state root must be an absolute safe path')
    this.#stateRoot = resolve(options.stateRoot); this.#registry = options.registry; this.#now = options.now ?? (() => new Date()); this.#fault = options.fault
  }

  async detect(adapterId: string): Promise<readonly AgentInstallation[]> {
    const installations = await this.#registry.require(adapterId).detect()
    for (const target of installations) this.#validateTarget(target, adapterId)
    return freeze(clone(installations))
  }

  async inspect(adapterId: string, target: AgentInstallation) {
    this.#validateTarget(target, adapterId); return freeze(clone(await this.#registry.require(adapterId).inspect(freeze(clone(target)))))
  }

  async planImport(adapterId: string, target: AgentInstallation): Promise<ImportPlan> {
    this.#validateTarget(target, adapterId); return this.#preparePlan(await this.#registry.require(adapterId).planImport(freeze(clone(target))), adapterId, target) as Promise<ImportPlan>
  }

  async planProjection(adapterId: string, selection: AssetSelection, target: AgentInstallation): Promise<ProjectionPlan> {
    this.#validateTarget(target, adapterId); this.#validateSelection(selection)
    return this.#preparePlan(await this.#registry.require(adapterId).planProjection(freeze(clone(selection)), freeze(clone(target))), adapterId, target) as Promise<ProjectionPlan>
  }

  approve(plan: AdapterPlan): ApprovedAdapterPlan {
    this.#validatePlanShape(plan); const actual = digest(planPayload(plan)); if (plan.digest !== actual) throw new Error('Adapter plan digest is stale or mutated')
    if (Date.parse(plan.expiresAt) <= this.#now().getTime()) throw new Error('Adapter plan has expired')
    return freeze({ ...clone(plan), approval: { schemaVersion: 1, operationId: randomUUID(), approvedAt: this.#now().toISOString(), planId: plan.planId, adapterId: plan.adapterId, installationId: plan.target.id, digest: actual } })
  }

  async apply(plan: ApprovedAdapterPlan): Promise<AdapterResult> {
    this.#validateApproval(plan)
    await this.#validateOperations(plan.target, plan.operations)
    await this.#validateBeforeStates(plan.operations)
    return serialized(this.#stateRoot, () => this.#withFileLock(false, async () => {
      this.#validateApproval(plan); await this.#validateOperations(plan.target, plan.operations); await this.#validateBeforeStates(plan.operations)
      let journal: AdapterJournal = this.#journal(plan, 'journaled', [])
      await this.#writeJournal(journal); await this.#fault?.('after-journal')
      try {
        journal = await this.#backup(journal)
        await this.#fault?.('before-apply')
        journal = await this.#phase(journal, 'applying')
        const adapterResult = await this.#registry.require(plan.adapterId).apply(freeze(clone(plan)))
        this.#validateAdapterResult(adapterResult, plan)
        await this.#verifyApplied(plan.operations)
        const appliedResult = freeze(clone(adapterResult)); journal = await this.#phase(journal, 'applied', appliedResult)
        await this.#fault?.('after-applied-journal')
        return await this.#commit(journal)
      } catch (error) {
        if (error instanceof SimulatedAdapterCrash) throw error
        try { await this.#rollbackJournal(await this.#readJournal(plan.approval.operationId)) } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Adapter apply failed and rollback could not prove safe completion', { cause: error }) }
        throw error
      }
    }))
  }

  async rollback(operationId: string): Promise<void> {
    if (!SAFE_SEGMENT.test(operationId)) throw new Error('Unsafe adapter operation id')
    await serialized(this.#stateRoot, () => this.#withFileLock(false, async () => {
      const journal = await this.#readJournal(operationId); if (journal.phase === 'rolled-back') return; if (journal.phase !== 'committed' && journal.phase !== 'rolling-back') throw new Error('Only a committed adapter operation can be explicitly rolled back')
      await this.#rollbackJournal(journal)
    }))
  }

  async recoverPending(): Promise<void> {
    await serialized(this.#stateRoot, () => this.#withFileLock(true, async () => {
      const directory = this.#journalDirectory(); let names: string[]
      try {
        const entries = await readdir(directory, { withFileTypes: true })
        if (entries.some((entry) => !entry.isFile() || !entry.name.endsWith('.json') || !SAFE_SEGMENT.test(entry.name.slice(0, -5)))) throw new Error('Unknown adapter journal directory entry')
        names = entries.map((entry) => entry.name).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      for (const name of names) {
        if (!SAFE_SEGMENT.test(name.slice(0, -5))) throw new Error('Malformed adapter journal filename')
        const journal = await this.#readJournal(name.slice(0, -5))
        if (journal.phase === 'committed' || journal.phase === 'rolled-back') continue
        if (journal.phase === 'applied') {
          try { await this.#verifyApplied(journal.plan.operations); await this.#commit(journal) } catch { await this.#rollbackJournal(journal) }
          continue
        }
        await this.#rollbackJournal(journal)
      }
    }))
  }

  async #preparePlan(plan: AdapterPlan, adapterId: string, target: AgentInstallation): Promise<AdapterPlan> {
    this.#validatePlanShape(plan)
    if (plan.adapterId !== adapterId) throw new Error('Adapter returned a foreign plan')
    if (!same(plan.target, target)) throw new Error('Adapter plan target does not match the requested installation')
    await this.#validateOperations(target, plan.operations, false)
    const clean = clone(plan); (clean as { operations: readonly PreviewFileOperation[] }).operations = await this.#bindBeforeState(clean.operations); await this.#validateOperations(target, clean.operations, true); (clean as { digest: string }).digest = digest(planPayload(clean)); return freeze(clean)
  }

  #validateTarget(target: AgentInstallation, adapterId: string): void {
    expectedKeys(target, ['schemaVersion', 'id', 'adapterId', 'displayName', 'nativeRoots'], 'Agent installation')
    if (target.schemaVersion !== 1 || target.adapterId !== adapterId || !SAFE_SEGMENT.test(target.id) || !target.displayName || !Array.isArray(target.nativeRoots) || !target.nativeRoots.length) throw new Error('Malformed or foreign adapter installation')
    const roots: string[] = []; const ids = new Set<string>()
    for (const root of target.nativeRoots) {
      expectedKeys(root, ['id', 'path'], 'Authorized native root')
      if (!SAFE_SEGMENT.test(root.id) || ids.has(root.id) || typeof root.path !== 'string' || !isAbsolute(root.path) || root.path.includes('\0') || resolve(root.path) !== root.path) throw new Error('Unsafe or duplicate authorized native root')
      const path = normalized(root.path); if (roots.some((other) => contains(other, path) || contains(path, other))) throw new Error('Authorized native roots overlap')
      ids.add(root.id); roots.push(path)
    }
  }

  #validateSelection(value: AssetSelection): void {
    expectedKeys(value, ['schemaVersion', 'assetIds', 'secretReferenceIds'], 'Asset selection')
    if (value.schemaVersion !== 1 || !Array.isArray(value.assetIds) || value.assetIds.some((id) => !SAFE_SEGMENT.test(id)) || new Set(value.assetIds).size !== value.assetIds.length) throw new Error('Malformed asset selection')
    this.#validateSecretReferences(value.secretReferenceIds)
  }

  #validatePlanShape(plan: AdapterPlan, allowApproval = false): void {
    if (!plan || typeof plan !== 'object') throw new Error('Malformed adapter plan')
    const allowed = plan.kind === 'projection' ? ['schemaVersion', 'kind', 'planId', 'adapterId', 'target', 'selection', 'operations', 'createdAt', 'expiresAt', 'digest'] : ['schemaVersion', 'kind', 'planId', 'adapterId', 'target', 'operations', 'createdAt', 'expiresAt', 'digest']
    expectedKeys(plan, allowApproval ? [...allowed, 'approval'] : allowed, 'Adapter plan')
    if (plan.schemaVersion !== 1 || (plan.kind !== 'import' && plan.kind !== 'projection') || !SAFE_SEGMENT.test(plan.planId) || !SAFE_SEGMENT.test(plan.adapterId) || !Array.isArray(plan.operations) || Number.isNaN(Date.parse(plan.createdAt)) || Number.isNaN(Date.parse(plan.expiresAt)) || typeof plan.digest !== 'string') throw new Error('Malformed adapter plan')
    this.#validateTarget(plan.target, plan.adapterId); if (plan.kind === 'projection') this.#validateSelection(plan.selection)
  }

  async #validateOperations(target: AgentInstallation, operations: readonly PreviewFileOperation[], requireBefore = true): Promise<void> {
    const roots = new Map(target.nativeRoots.map((root) => [root.id, root.path])); const paths = new Set<string>(); const ids = new Set<string>()
    for (const operation of operations) {
      expectedKeys(operation, ['id', 'kind', 'rootId', 'nativePath', 'expectedBeforeSha256', 'expectedAfterSha256'], 'Preview file operation')
      const root = roots.get(operation.rootId)
      if (!SAFE_SEGMENT.test(operation.id) || ids.has(operation.id) || !['read', 'create', 'modify', 'delete'].includes(operation.kind) || !root) throw new Error('Malformed or duplicate preview operation')
      if (typeof operation.nativePath !== 'string' || operation.nativePath.includes('\0') || !isAbsolute(operation.nativePath) || resolve(operation.nativePath) !== operation.nativePath || !contains(root, operation.nativePath)) throw new Error('Operation path must be absolute and contained by its authorized root')
      if ((operation.kind === 'create' || operation.kind === 'modify') && !SHA256.test(operation.expectedAfterSha256 ?? '')) throw new Error('Create and modify operations require an expected SHA-256 digest')
      if ((operation.kind === 'read' || operation.kind === 'delete') && operation.expectedAfterSha256 !== undefined) throw new Error('Unexpected after digest for read/delete operation')
      if (operation.kind === 'create' && operation.expectedBeforeSha256 !== undefined) throw new Error('Create operation cannot have a before digest')
      if (operation.kind !== 'create' && ((requireBefore && !operation.expectedBeforeSha256) || (operation.expectedBeforeSha256 !== undefined && !SHA256.test(operation.expectedBeforeSha256)))) throw new Error('Existing-path operation requires an expected before SHA-256 digest')
      const path = normalized(operation.nativePath); if (paths.has(path)) throw new Error('Duplicate or conflicting native operation path'); paths.add(path); ids.add(operation.id)
      await this.#rejectLinkedPath(root, operation.nativePath)
    }
  }

  async #bindBeforeState(operations: readonly PreviewFileOperation[]): Promise<readonly PreviewFileOperation[]> {
    const bound: PreviewFileOperation[] = []
    for (const operation of operations) {
      const stat = await statOrAbsent(operation.nativePath)
      if (operation.kind === 'create') { if (stat) throw new Error('Create target already exists during preview'); bound.push(clone(operation)); continue }
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Preview path is not an ordinary existing file')
      bound.push({ ...clone(operation), expectedBeforeSha256: digestBytes(await this.#readOrdinary(operation.nativePath)) })
    }
    return freeze(bound)
  }

  async #rejectLinkedPath(root: string, target: string): Promise<void> {
    const rootStat = await statOrAbsent(root); if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Authorized native root is missing, linked, or not a directory')
    const rel = relative(root, target); const parts = rel.split(sep); let current = root
    for (const part of parts) {
      current = join(current, part); const stat = await statOrAbsent(current); if (!stat) break
      if (stat.isSymbolicLink()) throw new Error('Operation path has a symbolic link or junction ancestor')
      if (current !== target && !stat.isDirectory()) throw new Error('Operation path has a non-directory ancestor')
      if (current === target && !stat.isFile()) throw new Error('Operation path is not an ordinary file')
    }
  }

  #validateApproval(plan: ApprovedAdapterPlan, checkExpiry = true): void {
    this.#validatePlanShape(plan, true)
    const approval = plan.approval; if (!approval || typeof approval !== 'object') throw new Error('Adapter plan approval is required')
    expectedKeys(approval, ['schemaVersion', 'operationId', 'approvedAt', 'planId', 'adapterId', 'installationId', 'digest'], 'Adapter plan approval')
    const actual = digest(planPayload(plan)); if (plan.digest !== actual || approval.digest !== actual) throw new Error('Approved adapter plan digest is stale or mutated')
    if (approval.schemaVersion !== 1 || !SAFE_SEGMENT.test(approval.operationId) || approval.planId !== plan.planId || approval.adapterId !== plan.adapterId) throw new Error('Foreign adapter approval')
    if (approval.installationId !== plan.target.id) throw new Error('Adapter approval target installation mismatch')
    if (Number.isNaN(Date.parse(approval.approvedAt)) || (checkExpiry && Date.parse(plan.expiresAt) <= this.#now().getTime())) throw new Error('Approved adapter plan has expired')
  }

  async #validateBeforeStates(operations: readonly PreviewFileOperation[]): Promise<void> {
    for (const operation of operations) {
      const stat = await statOrAbsent(operation.nativePath)
      if (operation.kind === 'create' && stat) throw new Error('Create target appeared after planning')
      if (operation.kind !== 'create' && (!stat || !stat.isFile() || stat.isSymbolicLink() || digestBytes(await this.#readOrdinary(operation.nativePath)) !== operation.expectedBeforeSha256)) throw new Error('Native file changed after planning; adapter plan is stale')
    }
  }

  #journal(plan: ApprovedAdapterPlan, phase: AdapterJournal['phase'], backupEntries: readonly AdapterBackupEntry[], result?: AdapterResult): AdapterJournal {
    const timestamp = this.#now().toISOString(); return freeze({ schemaVersion: 1, operationId: plan.approval.operationId, plan: clone(plan), phase, backupEntries: clone(backupEntries), startedAt: timestamp, updatedAt: timestamp, ...(result ? { result: clone(result) } : {}) })
  }

  async #backup(initial: AdapterJournal): Promise<AdapterJournal> {
    let journal = await this.#phase(initial, 'backing-up'); const changes = journal.plan.operations.filter((operation) => WRITE_KINDS.has(operation.kind))
    for (const [index, operation] of changes.entries()) {
      let entry: AdapterBackupEntry
      if (operation.kind === 'create') entry = { operationId: journal.operationId, operationEntryId: operation.id, rootId: operation.rootId, relativePath: this.#nativeRelative(journal.plan.target, operation), priorState: 'absent' }
      else {
        const backupRelativePath = `${index}.bin`; const bytes = await this.#readOrdinary(operation.nativePath); await this.#writeBackup(journal.operationId, backupRelativePath, bytes)
        entry = { operationId: journal.operationId, operationEntryId: operation.id, rootId: operation.rootId, relativePath: this.#nativeRelative(journal.plan.target, operation), priorState: 'file', backupRelativePath, priorSha256: digestBytes(bytes), priorBytes: bytes.byteLength }
      }
      journal = freeze({ ...journal, backupEntries: freeze([...journal.backupEntries, freeze(entry)]), updatedAt: this.#now().toISOString() }); await this.#writeJournal(journal); await this.#fault?.('after-backup-entry')
    }
    return this.#phase(journal, 'backed-up')
  }

  async #verifyApplied(operations: readonly PreviewFileOperation[]): Promise<void> {
    for (const operation of operations) {
      if (operation.kind === 'read') continue
      const stat = await statOrAbsent(operation.nativePath)
      if (operation.kind === 'delete') { if (stat) throw new Error(`Adapter verification failed for ${operation.id}`); continue }
      if (!stat || !stat.isFile() || stat.isSymbolicLink() || digestBytes(await this.#readOrdinary(operation.nativePath)) !== operation.expectedAfterSha256) throw new Error(`Adapter verification failed for ${operation.id}`)
    }
  }

  #validateAdapterResult(value: AdapterResult, plan: ApprovedAdapterPlan): void {
    this.#validateResult(value, plan, 'applied')
  }

  #validateResult(value: AdapterResult, plan: ApprovedAdapterPlan, status: AdapterResult['status']): void {
    expectedKeys(value, ['schemaVersion', 'operationId', 'planId', 'adapterId', 'installationId', 'status', 'verified', 'completedAt', 'secretReferenceIds'], 'Adapter result')
    if (value.schemaVersion !== 1 || value.operationId !== plan.approval.operationId || value.planId !== plan.planId || value.adapterId !== plan.adapterId || value.installationId !== plan.target.id || value.status !== status || value.verified !== true || Number.isNaN(Date.parse(value.completedAt))) throw new Error('Adapter returned malformed or mismatched result')
    this.#validateSecretReferences(value.secretReferenceIds)
  }

  #validateSecretReferences(value?: readonly string[]): void { if (value !== undefined && (!Array.isArray(value) || value.some((id) => !SAFE_SEGMENT.test(id)))) throw new Error('Malformed secret reference id') }

  async #commit(journal: AdapterJournal): Promise<AdapterResult> {
    if (!journal.result) throw new Error('Applied adapter journal has no result')
    const result = freeze({ ...journal.result, status: 'committed' as const, completedAt: this.#now().toISOString() }); await this.#writeJournal(freeze({ ...journal, phase: 'committed', result, updatedAt: this.#now().toISOString() })); return result
  }

  async #rollbackJournal(input: AdapterJournal): Promise<void> {
    if (input.phase === 'rolled-back') return
    let journal = await this.#phase(input, 'rolling-back')
    const entries = [...journal.backupEntries].reverse()
    for (const entry of entries) {
      const operation = journal.plan.operations.find((candidate) => candidate.id === entry.operationEntryId); if (!operation) throw new Error('Malformed adapter backup entry operation')
      const nativePath = this.#nativeFromEntry(journal.plan.target, entry); if (normalized(nativePath) !== normalized(operation.nativePath)) throw new Error('Malformed adapter backup target')
      await this.#rejectLinkedPath(journal.plan.target.nativeRoots.find((root) => root.id === entry.rootId)!.path, nativePath)
      if (entry.priorState === 'file') {
        if (!entry.backupRelativePath || !safeRelative(entry.backupRelativePath) || !SHA256.test(entry.priorSha256 ?? '') || !Number.isSafeInteger(entry.priorBytes) || entry.priorBytes! < 0) throw new Error('Malformed adapter backup entry')
        const bytes = await this.#readBackup(journal.operationId, entry.backupRelativePath); if (bytes.byteLength !== entry.priorBytes || digestBytes(bytes) !== entry.priorSha256) throw new Error('Adapter backup verification failed')
        await this.#writeNative(nativePath, bytes)
      } else {
        if (entry.backupRelativePath || entry.priorSha256 || entry.priorBytes !== undefined) throw new Error('Malformed absent-before backup marker')
        const stat = await statOrAbsent(nativePath); if (!stat) continue
        if (!stat.isFile() || stat.isSymbolicLink() || !operation.expectedAfterSha256 || digestBytes(await this.#readOrdinary(nativePath)) !== operation.expectedAfterSha256) throw new Error('Rollback cannot prove safe removal of an absent-before path')
        await unlink(nativePath)
      }
    }
    const rolled: AdapterResult = { schemaVersion: 1, operationId: journal.operationId, planId: journal.plan.planId, adapterId: journal.plan.adapterId, installationId: journal.plan.target.id, status: 'rolled-back', verified: true, completedAt: this.#now().toISOString(), ...(journal.result?.secretReferenceIds ? { secretReferenceIds: journal.result.secretReferenceIds } : {}) }
    journal = freeze({ ...journal, phase: 'rolled-back', result: freeze(rolled), updatedAt: this.#now().toISOString() }); await this.#writeJournal(journal)
  }

  async #phase(journal: AdapterJournal, phase: AdapterJournal['phase'], result = journal.result): Promise<AdapterJournal> { const next = freeze({ ...journal, phase, updatedAt: this.#now().toISOString(), ...(result ? { result } : {}) }); await this.#writeJournal(next); return next }
  #nativeRelative(target: AgentInstallation, operation: PreviewFileOperation): string { const root = target.nativeRoots.find((item) => item.id === operation.rootId)!; const value = relative(root.path, operation.nativePath); if (!safeRelative(value)) throw new Error('Unsafe native backup-relative path'); return value.split(sep).join('/') }
  #nativeFromEntry(target: AgentInstallation, entry: AdapterBackupEntry): string { if (!safeRelative(entry.relativePath)) throw new Error('Malformed adapter backup relative path'); const root = target.nativeRoots.find((item) => item.id === entry.rootId); if (!root) throw new Error('Malformed adapter backup root id'); const path = resolve(root.path, ...entry.relativePath.split('/')); if (!contains(root.path, path)) throw new Error('Unsafe adapter backup target'); return path }

  async #readOrdinary(path: string): Promise<Buffer> {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0); const handle = await open(path, flags)
    try { const stat = await handle.stat(); if (!stat.isFile()) throw new Error('Adapter path is not an ordinary file'); return await handle.readFile() } finally { await handle.close() }
  }
  async #writeBackup(operationId: string, relativePath: string, bytes: Buffer): Promise<void> { const path = this.#backupPath(operationId, relativePath); await mkdir(dirname(path), { recursive: true }); const handle = await open(path, 'wx'); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
  async #readBackup(operationId: string, relativePath: string): Promise<Buffer> { if (!safeRelative(relativePath)) throw new Error('Unsafe adapter backup path'); const path = this.#backupPath(operationId, relativePath); await this.#rejectLinkedBackupPath(operationId, path); return this.#readOrdinary(path) }
  async #writeNative(path: string, bytes: Buffer): Promise<void> { await mkdir(dirname(path), { recursive: true }); const handle = await open(path, 'w'); try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() } }
  async #rejectLinkedBackupPath(operationId: string, path: string): Promise<void> { const root = this.#backupDirectory(operationId); if (!contains(root, path)) throw new Error('Unsafe adapter backup path'); const rootStat = await statOrAbsent(root); if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Malformed adapter backup directory'); const stat = await statOrAbsent(path); if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Malformed adapter backup file') }

  async #readJournal(operationId: string): Promise<AdapterJournal> {
    let value: unknown
    try { value = JSON.parse(await readFile(this.#journalPath(operationId), 'utf8')) } catch (error) { throw new Error(`Malformed adapter journal: ${operationId}`, { cause: error }) }
    const journal = value as AdapterJournal
    try {
      expectedKeys(journal, ['schemaVersion', 'operationId', 'plan', 'phase', 'backupEntries', 'startedAt', 'updatedAt', 'result'], 'Adapter journal')
      if (journal.schemaVersion !== 1 || journal.operationId !== operationId || !Array.isArray(journal.backupEntries) || !['journaled', 'backing-up', 'backed-up', 'applying', 'applied', 'committed', 'rolling-back', 'rolled-back'].includes(journal.phase) || Number.isNaN(Date.parse(journal.startedAt)) || Number.isNaN(Date.parse(journal.updatedAt))) throw new Error('invalid fields')
      this.#validateApproval(journal.plan, false); await this.#validateOperations(journal.plan.target, journal.plan.operations)
      for (const entry of journal.backupEntries) { expectedKeys(entry, ['operationId', 'operationEntryId', 'rootId', 'relativePath', 'priorState', 'backupRelativePath', 'priorSha256', 'priorBytes'], 'Adapter backup entry'); if (entry.operationId !== operationId || !SAFE_SEGMENT.test(entry.operationEntryId) || !SAFE_SEGMENT.test(entry.rootId) || !safeRelative(entry.relativePath) || (entry.priorState !== 'file' && entry.priorState !== 'absent') || (entry.backupRelativePath !== undefined && !safeRelative(entry.backupRelativePath))) throw new Error('invalid backup entry') }
      this.#validateJournalInvariants(journal)
    } catch (error) { throw new Error(`Malformed adapter journal: ${operationId}`, { cause: error }) }
    return freeze(journal)
  }

  #validateJournalInvariants(journal: AdapterJournal): void {
    const changes = journal.plan.operations.filter((operation) => WRITE_KINDS.has(operation.kind)); const entries = journal.backupEntries
    const complete = ['backed-up', 'applying', 'applied', 'committed'].includes(journal.phase)
    if ((journal.phase === 'journaled' && entries.length !== 0) || (complete && entries.length !== changes.length) || entries.length > changes.length) throw new Error('Journal backup evidence is incomplete for its phase')
    for (const [index, entry] of entries.entries()) {
      const operation = changes[index]; if (!operation || entry.operationEntryId !== operation.id || entry.rootId !== operation.rootId || entry.relativePath !== this.#nativeRelative(journal.plan.target, operation)) throw new Error('Journal backup evidence does not match the approved operation')
      if (operation.kind === 'create') { if (entry.priorState !== 'absent' || entry.backupRelativePath !== undefined || entry.priorSha256 !== undefined || entry.priorBytes !== undefined) throw new Error('Malformed absent-before evidence') }
      else if (entry.priorState !== 'file' || entry.backupRelativePath !== `${index}.bin` || entry.priorSha256 !== operation.expectedBeforeSha256 || !Number.isSafeInteger(entry.priorBytes) || entry.priorBytes! < 0) throw new Error('Malformed file backup evidence')
    }
    if (journal.phase === 'applied') { if (!journal.result) throw new Error('Applied journal requires a result'); this.#validateResult(journal.result, journal.plan, 'applied') }
    else if (journal.phase === 'committed') { if (!journal.result) throw new Error('Committed journal requires a result'); this.#validateResult(journal.result, journal.plan, 'committed') }
    else if (journal.phase === 'rolled-back') { if (!journal.result) throw new Error('Rolled-back journal requires a result'); this.#validateResult(journal.result, journal.plan, 'rolled-back') }
    else if (journal.phase === 'rolling-back') { if (journal.result) { if (journal.result.status !== 'applied' && journal.result.status !== 'committed') throw new Error('Rolling-back journal has an invalid result'); this.#validateResult(journal.result, journal.plan, journal.result.status) } }
    else if (journal.result) throw new Error('Journal phase cannot contain a result')
  }

  async #writeJournal(journal: AdapterJournal): Promise<void> { await writeJsonAtomic(this.#journalPath(journal.operationId), journal) }
  #journalDirectory(): string { return join(this.#stateRoot, '.ash', 'adapters', 'journals') }
  #journalPath(operationId: string): string { if (!SAFE_SEGMENT.test(operationId)) throw new Error('Unsafe adapter operation id'); return join(this.#journalDirectory(), `${operationId}.json`) }
  #backupDirectory(operationId: string): string { if (!SAFE_SEGMENT.test(operationId)) throw new Error('Unsafe adapter operation id'); return join(this.#stateRoot, '.ash-backups', 'adapters', operationId) }
  #backupPath(operationId: string, relativePath: string): string { if (!safeRelative(relativePath)) throw new Error('Unsafe adapter backup path'); const root = this.#backupDirectory(operationId); const path = resolve(root, relativePath); if (!contains(root, path)) throw new Error('Unsafe adapter backup path'); return path }

  async #withFileLock<T>(recovery: boolean, operation: () => Promise<T>): Promise<T> {
    const directory = join(this.#stateRoot, '.ash', 'adapters'); await mkdir(directory, { recursive: true }); const lock = await acquireMigrationFileLock(join(directory, 'coordinator'), recovery)
    try { return await operation() } finally { await lock.release() }
  }
}

function digestBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
