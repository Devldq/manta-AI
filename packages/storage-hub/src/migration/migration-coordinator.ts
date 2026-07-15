import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AshBootstrap, AshLocationSnapshot, MigrationJournal, MigrationPhase, StorageGroupId, StorageOperationProgress, StorageVolumeRecord } from '@manta/shared'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { writeJsonAtomic } from '../bootstrap/atomic-json'
import { volumeRoot } from '../domain/invariants'
import { inventoryTree, type StorageInventory } from '../inventory/file-inventory'
import { StorageLeaseManager, type StorageLease } from '../runtime/lease-manager'
import { copyTree } from './copy-tree'
import { acquireMigrationFileLock } from './migration-lock'
import type { MigrationFaultPoint, ProgressHandler, StorageGroupDriver } from './types'

const MIN_MARGIN = 256 * 1024 * 1024
const PRECOMMIT = new Set<MigrationPhase>(['planned', 'quiescing', 'copying', 'validating'])
const snapshot = (value: AshBootstrap): AshLocationSnapshot => ({ generation: value.generation, volumes: value.volumes, groupAssignments: value.groupAssignments })
const digestInventory = (value: StorageInventory): string => createHash('sha256').update(JSON.stringify(value.entries)).digest('hex')

export interface MigrationCoordinatorOptions { store: BootstrapStore; leases: StorageLeaseManager; drivers: Map<StorageGroupId, StorageGroupDriver>; availableBytes?: (targetPath: string) => Promise<number>; fault?: (point: MigrationFaultPoint) => Promise<void>; onProgress?: ProgressHandler; leaseTimeoutMs?: number }

export class SimulatedMigrationCrash extends Error {
  constructor(readonly point: string) { super(`Simulated migration crash: ${point}`); this.name = 'SimulatedMigrationCrash' }
}

export class MigrationCoordinator {
  private running = false
  constructor(private readonly options: MigrationCoordinatorOptions) {}

  async relocateVolume(volumeId: string, targetParentPath: string, operationId = randomUUID()): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const volume = this.volume(current, volumeId); const groups = this.groupsFor(current, volumeId)
      const sourceRoot = volumeRoot(volume.parentPath); const finalRoot = volumeRoot(targetParentPath); await this.rejectOverlap(sourceRoot, finalRoot); await this.ensureAbsent(finalRoot)
      const id = operationId; const staging = join(dirname(finalRoot), `${basename(finalRoot)}.migrating-${id}`); const inventory = await inventoryTree(sourceRoot); await this.ensureCapacity(targetParentPath, inventory.bytes)
      let lease: StorageLease | undefined; const closed: StorageGroupId[] = []; let committed = false; let journal = this.journal(id, 'volume', volumeId, groups, current, { targetParentPath }, inventory)
      try {
        lease = await this.options.leases.acquireExclusive(groups, { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 }); await this.persistJournal(current, journal)
        journal = await this.phase(current, journal, 'quiescing'); await Promise.all(groups.map((group) => this.driver(group).quiesce())); await Promise.all(groups.map((group) => this.driver(group).checkpoint()))
        for (const group of groups) { await this.driver(group).close(); closed.push(group) }
        journal = await this.phase(current, journal, 'copying'); await this.options.fault?.('copying'); await copyTree(sourceRoot, staging, inventory, (files, bytes) => { journal.filesCompleted = files; journal.bytesCompleted = bytes; this.progress(journal, 'copying') })
        journal = await this.phase(current, journal, 'validating'); await this.options.fault?.('validating'); await this.validateCopy(inventory, staging, groups)
        await rename(staging, finalRoot); await this.writeManifest(finalRoot, volume, groups, current.generation + 1, 'active'); await this.options.fault?.('before-bootstrap-commit')
        journal = { ...journal, phase: 'committing' }; const next = this.committedBootstrap(current, journal, { volumes: current.volumes.map((item) => item.id === volumeId ? { ...item, parentPath: targetParentPath, updatedAt: new Date().toISOString() } : item) })
        await this.options.store.write(next); committed = true; await this.options.fault?.('after-bootstrap-commit'); await this.verifyTargets(next, journal, groups)
        await this.writeManifest(sourceRoot, volume, groups, current.generation, 'backup', id); await this.complete(next, journal); return id
      } catch (error) {
        if (lease) await this.cleanup(error, committed ? [() => this.rollback(current, groups, staging, finalRoot, id)] : [() => this.options.store.write(current), () => this.isolate(staging, finalRoot, id), () => this.writeManifests(current), () => this.reopen(current, closed)])
        throw error
      } finally { lease?.release() }
    })
  }

  async moveGroup(group: StorageGroupId, targetVolumeId: string, operationId = randomUUID()): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const sourceVolumeId = current.groupAssignments[group]; if (sourceVolumeId === targetVolumeId) throw new Error(`${group} is already assigned to ${targetVolumeId}`)
      const source = this.volume(current, sourceVolumeId); const target = this.volume(current, targetVolumeId); const sourcePath = join(volumeRoot(source.parentPath), group); const targetPath = join(volumeRoot(target.parentPath), group); await this.rejectOverlap(sourcePath, targetPath); await this.ensureAbsent(targetPath)
      const id = operationId; const staging = join(volumeRoot(target.parentPath), '.ash-staging', id, group); const backup = join(volumeRoot(source.parentPath), '.ash-backups', id, group); const inventory = await inventoryTree(sourcePath); await this.ensureCapacity(target.parentPath, inventory.bytes)
      let lease: StorageLease | undefined; let closed = false; let committed = false; let journal = this.journal(id, 'group', sourceVolumeId, [group], current, { targetVolumeId }, inventory)
      try {
        lease = await this.options.leases.acquireExclusive([group], { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 }); await this.persistJournal(current, journal)
        const driver = this.driver(group); journal = await this.phase(current, journal, 'quiescing'); await driver.quiesce(); await driver.checkpoint(); await driver.close(); closed = true
        journal = await this.phase(current, journal, 'copying'); await this.options.fault?.('copying'); await copyTree(sourcePath, staging, inventory, (files, bytes) => { journal.filesCompleted = files; journal.bytesCompleted = bytes; this.progress(journal, 'copying', group) })
        journal = await this.phase(current, journal, 'validating'); await this.options.fault?.('validating'); await this.validateCopy(inventory, staging, [group], true); await mkdir(dirname(targetPath), { recursive: true }); await rename(staging, targetPath)
        const assignments = { ...current.groupAssignments, [group]: targetVolumeId }; const next = this.committedBootstrap(current, { ...journal, phase: 'committing' }, { groupAssignments: assignments }); await this.writeManifests(next); await this.options.fault?.('before-bootstrap-commit'); await this.options.store.write(next); committed = true
        await this.options.fault?.('after-bootstrap-commit'); await this.verifyTargets(next, journal, [group]); await mkdir(dirname(backup), { recursive: true }); await rename(sourcePath, backup); await this.complete(next, journal); return id
      } catch (error) {
        if (lease) await this.cleanup(error, committed ? [() => this.restoreBackup(backup, sourcePath), () => this.rollback(current, [group], staging, targetPath, id)] : [() => this.options.store.write(current), () => this.isolate(staging, targetPath, id), () => this.writeManifests(current), ...(closed ? [() => this.reopen(current, [group])] : [])])
        throw error
      } finally { lease?.release() }
    })
  }

  /**
   * Replaces one active group from a fully validated cache staging directory.
   * The caller never supplies a live destination: this coordinator resolves it
   * from the canonical bootstrap and keeps a recoverable backup until reopen
   * validation succeeds.
   */
  async replaceGroupFromStaging(group: StorageGroupId, stagedGroupPath: string, operationId = randomUUID()): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const volume = this.volume(current, current.groupAssignments[group])
      const target = join(volumeRoot(volume.parentPath), group); const staging = join(volumeRoot(volume.parentPath), '.ash-staging', operationId, group); const backup = join(volumeRoot(volume.parentPath), '.ash-backups', operationId, group)
      const inventory = await inventoryTree(stagedGroupPath); let lease: StorageLease | undefined; let closed = false; let backedUp = false
      try {
        lease = await this.options.leases.acquireExclusive([group], { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 })
        const driver = this.driver(group); await driver.quiesce(); await driver.checkpoint(); await driver.close(); closed = true
        await copyTree(stagedGroupPath, staging, inventory); await this.validateCopy(inventory, staging, [group], true)
        await mkdir(dirname(backup), { recursive: true }); await this.renameIfPresent(target, backup); backedUp = true
        await mkdir(dirname(target), { recursive: true }); await rename(staging, target)
        await driver.reopen(target); const validation = await driver.validate(target); if (!validation.ok) throw new Error(validation.error ?? `Imported ${group} validation failed`)
        await rm(backup, { recursive: true, force: true }); return operationId
      } catch (error) {
        // Before the old group is moved there is nothing to restore; never
        // quarantine the still-live target on a staging validation failure.
        if (backedUp) { await this.isolate(staging, target, operationId); await this.restoreBackup(backup, target) }
        else await this.isolate(staging, join(staging, '.never-live'), operationId)
        if (closed) await this.driver(group).reopen(target)
        throw error
      } finally { lease?.release() }
    })
  }

  /**
   * Imports several independently stored groups as one live-data transaction.
   * Backups are retained until every new group reopens and validates; a failure
   * in a later group restores all earlier groups before the error escapes.
   */
  async replaceGroupsFromStaging(groups: Array<{ group: StorageGroupId; source: string }>, operationId: string = randomUUID(), preflight?: () => Promise<void>): Promise<string> {
    if (!groups.length) return operationId
    const unique = new Set(groups.map(({ group }) => group))
    if (unique.size !== groups.length) throw new Error('An import group may only be selected once')
    return this.transaction(async () => {
      const current = await this.requiredBootstrap()
      const values = await Promise.all(groups.map(async ({ group, source }) => ({ group, source, inventory: await inventoryTree(source) })))
      let lease: StorageLease | undefined
      const closed: StorageGroupId[] = []
      const targetFor = (group: StorageGroupId) => { const volume = this.volume(current, current.groupAssignments[group]); return join(volumeRoot(volume.parentPath), group) }
      const stagingFor = (group: StorageGroupId) => join(dirname(targetFor(group)), '.ash-staging', operationId, group)
      const backupFor = (group: StorageGroupId) => join(dirname(targetFor(group)), '.ash-backups', operationId, group)
      const totals = values.reduce((result, value) => ({ files: result.files + value.inventory.files, bytes: result.bytes + value.inventory.bytes }), { files: 0, bytes: 0 })
      let journal: MigrationJournal = { id: operationId, kind: 'import', sourceVolumeId: current.groupAssignments[values[0].group], groups: values.map(({ group }) => group), sourceGeneration: current.generation, targetGeneration: current.generation + 1, phase: 'planned', filesCompleted: 0, filesTotal: totals.files, bytesCompleted: 0, bytesTotal: totals.bytes, manifestDigest: createHash('sha256').update(values.map(({ group, inventory }) => `${group}:${digestInventory(inventory)}`).join('\n')).digest('hex') }
      try {
        lease = await this.options.leases.acquireExclusive(groups.map(({ group }) => group), { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 })
        await preflight?.(); this.assertImportOperationId(operationId); await this.persistJournal(current, journal)
        journal = await this.phase(current, journal, 'quiescing')
        for (const { group } of values) { const driver = this.driver(group); await driver.quiesce(); await driver.checkpoint(); await driver.close(); closed.push(group) }
        journal = await this.phase(current, journal, 'copying')
        for (const value of values) { const staging = stagingFor(value.group); await this.ensureAbsent(staging); await copyTree(value.source, staging, value.inventory); journal.filesCompleted += value.inventory.files; journal.bytesCompleted += value.inventory.bytes; this.progress(journal, 'copying', value.group) }
        journal = await this.phase(current, journal, 'validating')
        for (const value of values) await this.validateCopy(value.inventory, stagingFor(value.group), [value.group], true)
        journal = await this.phase(current, journal, 'committing'); await this.options.fault?.('before-import-first-rename')
        for (const value of values) {
          const target = targetFor(value.group); const backup = backupFor(value.group); await mkdir(dirname(backup), { recursive: true }); await rename(target, backup); await this.options.fault?.(`after-import-live-to-backup:${value.group}`)
          await mkdir(dirname(target), { recursive: true }); await rename(stagingFor(value.group), target); await this.options.fault?.(`after-import-staging-to-live:${value.group}`)
        }
        journal = await this.phase(current, journal, 'restarting'); await this.options.fault?.('after-import-restarting-journal')
        journal = await this.phase(current, journal, 'verifying')
        for (const value of values) { const target = targetFor(value.group); await this.driver(value.group).reopen(target); const validation = await this.driver(value.group).validate(target); if (!validation.ok) throw new Error(validation.error ?? `Imported ${value.group} validation failed`) }
        journal = { ...journal, phase: 'completed' }; await this.persistJournal(current, journal); await this.options.fault?.('after-import-completed-journal')
        for (const value of values) await rm(backupFor(value.group), { recursive: true, force: true })
        await this.options.store.write({ ...current, generation: journal.targetGeneration, previous: snapshot(current), pendingMigration: undefined })
        return operationId
      } catch (error) {
        if (error instanceof SimulatedMigrationCrash || journal.phase === 'completed') throw error
        if (lease) await this.rollbackImport(current, journal)
        throw error
      } finally { lease?.release() }
    })
  }

  async recoverPending(): Promise<AshBootstrap | undefined> {
    const lock = await acquireMigrationFileLock(this.options.store.filePath, true)
    try {
      const current = await this.options.store.read(); const journal = current?.pendingMigration; if (!current || !journal) return current; if (!current.previous) throw new Error('Pending migration has no previous snapshot')
      const previous: AshBootstrap = { schemaVersion: 1, ...current.previous }
      if (journal.kind === 'import') return await this.recoverImport(current, previous, journal)
      const paths = this.pathsFor(current, previous, journal)
      if (PRECOMMIT.has(journal.phase)) { await this.isolate(paths.staging, paths.final, journal.id); await this.writeManifests(previous); await this.reopen(previous, journal.groups); await this.options.store.write(previous); return previous }
      try {
        await this.verifyTargets(current, journal, journal.groups)
        await this.writeManifests(current)
        if (journal.kind === 'group') { await mkdir(dirname(paths.backup), { recursive: true }); await this.renameIfPresent(paths.source, paths.backup) } else { const sourceVolume = this.volume(previous, journal.sourceVolumeId); await this.writeManifest(paths.source, sourceVolume, journal.groups, journal.sourceGeneration, 'backup', journal.id) }
        await this.complete(current, journal); return (await this.options.store.read())!
      } catch (error) { await this.cleanup(error, [() => this.restoreBackup(paths.backup, paths.source), () => this.rollback(previous, journal.groups, paths.staging, paths.final, journal.id)]); throw error }
    } finally { await lock.release() }
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> { if (this.running) throw new Error('A storage mapping transaction is already in progress'); this.running = true; const lock = await acquireMigrationFileLock(this.options.store.filePath).catch((error) => { this.running = false; throw error }); try { return await operation() } finally { this.running = false; await lock.release() } }
  private async requiredBootstrap(): Promise<AshBootstrap> { const value = await this.options.store.read(); if (!value) throw new Error('Bootstrap does not exist'); if (value.pendingMigration) throw new Error('Pending migration must be recovered first'); return value }
  private driver(group: StorageGroupId): StorageGroupDriver { const value = this.options.drivers.get(group); if (!value) throw new Error(`Missing storage driver for ${group}`); return value }
  private volume(value: AshBootstrap, id: string): StorageVolumeRecord { const volume = value.volumes.find((item) => item.id === id); if (!volume) throw new Error(`Unknown volume ${id}`); return volume }
  private groupsFor(value: AshBootstrap, id: string): StorageGroupId[] { return Object.entries(value.groupAssignments).filter(([, volume]) => volume === id).map(([group]) => group as StorageGroupId) }
  private journal(id: string, kind: 'volume' | 'group', sourceVolumeId: string, groups: StorageGroupId[], current: AshBootstrap, target: Pick<MigrationJournal, 'targetVolumeId' | 'targetParentPath'>, inventory: StorageInventory): MigrationJournal { return { id, kind, sourceVolumeId, ...target, groups, sourceGeneration: current.generation, targetGeneration: current.generation + 1, phase: 'planned', filesCompleted: 0, filesTotal: inventory.files, bytesCompleted: 0, bytesTotal: inventory.bytes, manifestDigest: digestInventory(inventory) } }
  private async persistJournal(current: AshBootstrap, journal: MigrationJournal): Promise<void> { await this.options.store.write({ ...current, generation: journal.targetGeneration, previous: snapshot(current), pendingMigration: journal }); this.progress(journal, journal.phase) }
  private async phase(current: AshBootstrap, journal: MigrationJournal, phase: MigrationPhase): Promise<MigrationJournal> { const next = { ...journal, phase }; await this.persistJournal(current, next); return next }
  private committedBootstrap(current: AshBootstrap, journal: MigrationJournal, changes: Partial<AshBootstrap>): AshBootstrap { return { ...current, ...changes, generation: journal.targetGeneration, previous: snapshot(current), pendingMigration: journal } }
  private progress(journal: MigrationJournal, phase: string, currentGroup?: StorageGroupId): void { const value: StorageOperationProgress = { operationId: journal.id, operationKind: journal.kind, phase, currentGroup, filesCompleted: journal.filesCompleted, filesTotal: journal.filesTotal, bytesCompleted: journal.bytesCompleted, bytesTotal: journal.bytesTotal, message: phase }; this.options.onProgress?.(value) }
  private async ensureCapacity(target: string, sourceBytes: number): Promise<void> { const available = await (this.options.availableBytes?.(target) ?? Promise.resolve(Number.MAX_SAFE_INTEGER)); const required = sourceBytes + Math.max(Math.ceil(sourceBytes * 0.1), MIN_MARGIN); if (available < required) throw new Error(`Insufficient space: ${required} bytes required`) }
  private async ensureAbsent(path: string): Promise<void> { try { await access(path); throw new Error(`Migration target already exists: ${path}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  private contains(parent: string, child: string): boolean { const p = process.platform === 'win32' ? resolve(parent).toLowerCase() : resolve(parent); const c = process.platform === 'win32' ? resolve(child).toLowerCase() : resolve(child); const rel = relative(p, c); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) }
  private async canonical(path: string): Promise<string> { let ancestor = resolve(path); const suffix: string[] = []; while (true) { try { return join(await realpath(ancestor), ...suffix.reverse()) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = dirname(ancestor); if (parent === ancestor) throw error; suffix.push(basename(ancestor)); ancestor = parent } } }
  private async rejectOverlap(source: string, target: string): Promise<void> { const [sourceReal, targetReal] = await Promise.all([this.canonical(source), this.canonical(target)]); if (this.contains(source, target) || this.contains(target, source) || this.contains(sourceReal, targetReal) || this.contains(targetReal, sourceReal)) throw new Error('Migration source and target overlap') }
  private async validateCopy(expected: StorageInventory, target: string, groups: StorageGroupId[], groupRoot = false): Promise<void> { const actual = await inventoryTree(target); if (digestInventory(expected) !== digestInventory(actual)) throw new Error('Copied inventory does not match source'); for (const group of groups) { const result = await this.driver(group).validate(groupRoot ? target : join(target, group)); if (!result.ok) throw new Error(result.error ?? `Validation failed for ${group}`) } }
  private async verifyTargets(value: AshBootstrap, journal: MigrationJournal, groups: StorageGroupId[]): Promise<void> { await this.options.store.write({ ...value, pendingMigration: { ...journal, phase: 'restarting' } }); await this.options.store.write({ ...value, pendingMigration: { ...journal, phase: 'verifying' } }); for (const group of groups) { const volume = this.volume(value, value.groupAssignments[group]); const root = join(volumeRoot(volume.parentPath), group); await this.driver(group).reopen(root); const result = await this.driver(group).validate(root); if (!result.ok) throw new Error(result.error ?? `Post-commit validation failed for ${group}`) } }
  private async complete(value: AshBootstrap, journal: MigrationJournal): Promise<void> { const completed = { ...journal, phase: 'completed' as const }; await this.options.store.write({ ...value, pendingMigration: completed }); this.progress(completed, 'completed'); await this.options.store.write({ ...value, pendingMigration: undefined }) }
  private async reopen(value: AshBootstrap, groups: StorageGroupId[]): Promise<void> { for (const group of groups) { const volume = this.volume(value, value.groupAssignments[group]); await this.driver(group).reopen(join(volumeRoot(volume.parentPath), group)) } }
  private async rollback(current: AshBootstrap, groups: StorageGroupId[], staging: string, final: string, id: string): Promise<void> { await this.isolate(staging, final, id); await this.writeManifests(current); await this.options.store.write(current); await this.reopen(current, groups) }
  private async cleanup(original: unknown, actions: Array<() => Promise<unknown>>): Promise<void> { const failures: unknown[] = []; for (const action of actions) { try { await action() } catch (error) { failures.push(error) } } if (failures.length) throw new AggregateError([original, ...failures], original instanceof Error ? original.message : 'Migration failed', { cause: original }) }
  private async isolate(staging: string, final: string, id: string): Promise<void> { for (const candidate of [staging, final]) { try { await rename(candidate, `${candidate}.failed-${id}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(candidate, { recursive: true, force: true }) } } }
  private async renameIfPresent(source: string, target: string): Promise<void> { try { await rename(source, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  private async restoreBackup(backup: string, source: string): Promise<void> { try { await access(source); return } catch {} await mkdir(dirname(source), { recursive: true }); await this.renameIfPresent(backup, source) }
  private assertImportOperationId(id: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('Import operation id is unsafe') }
  private async pathExists(path: string): Promise<boolean> { try { await access(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
  private importPaths(value: AshBootstrap, journal: MigrationJournal, group: StorageGroupId): { target: string; staging: string; backup: string } {
    if (journal.kind !== 'import' || !journal.groups.includes(group)) throw new Error('Invalid import journal group')
    this.assertImportOperationId(journal.id)
    const volume = this.volume(value, value.groupAssignments[group]); const root = volumeRoot(volume.parentPath); const target = join(root, group)
    return { target, staging: join(root, '.ash-staging', journal.id, group), backup: join(root, '.ash-backups', journal.id, group) }
  }
  private async rollbackImport(previous: AshBootstrap, journal: MigrationJournal): Promise<void> {
    const layouts = await Promise.all(journal.groups.map(async (group) => { const paths = this.importPaths(previous, journal, group); return { group, paths, backup: await this.pathExists(paths.backup), target: await this.pathExists(paths.target) } }))
    for (const layout of layouts) if (!layout.backup && !layout.target) throw new Error(`Import recovery cannot locate old ${layout.group} data`)
    for (const { paths, backup } of [...layouts].reverse()) {
      if (backup) { await rm(paths.target, { recursive: true, force: true }); await mkdir(dirname(paths.target), { recursive: true }); await rename(paths.backup, paths.target) }
      await rm(paths.staging, { recursive: true, force: true })
    }
    for (const { group, paths } of layouts) { await this.driver(group).reopen(paths.target); const validation = await this.driver(group).validate(paths.target); if (!validation.ok) throw new Error(validation.error ?? `Recovered ${group} validation failed`) }
    await this.options.store.write(previous)
  }
  private async recoverImport(current: AshBootstrap, previous: AshBootstrap, journal: MigrationJournal): Promise<AshBootstrap> {
    this.assertImportOperationId(journal.id)
    if (PRECOMMIT.has(journal.phase) || journal.phase === 'committing' || journal.phase === 'rolling-back' || journal.phase === 'failed') { await this.rollbackImport(previous, journal); return (await this.options.store.read())! }
    const layouts = journal.groups.map((group) => ({ group, paths: this.importPaths(previous, journal, group) }))
    if (journal.phase === 'restarting' || journal.phase === 'verifying') {
      for (const { group, paths } of layouts) if (!await this.pathExists(paths.target) || !await this.pathExists(paths.backup) || await this.pathExists(paths.staging)) throw new Error(`Import roll-forward layout is incomplete for ${group}`)
      const verifying = { ...journal, phase: 'verifying' as const }; await this.options.store.write({ ...current, pendingMigration: verifying })
      try {
        for (const { group, paths } of layouts) { await this.driver(group).reopen(paths.target); const validation = await this.driver(group).validate(paths.target); if (!validation.ok) throw new Error(validation.error ?? `Imported ${group} validation failed`) }
      } catch (error) { await this.rollbackImport(previous, journal); throw error }
      const completed = { ...journal, phase: 'completed' as const }; await this.options.store.write({ ...current, pendingMigration: completed })
    } else if (journal.phase !== 'completed') throw new Error(`Unknown import recovery phase ${journal.phase}`)
    for (const { group, paths } of layouts) { if (!await this.pathExists(paths.target)) throw new Error(`Completed import target is missing for ${group}`); await rm(paths.backup, { recursive: true, force: true }); await rm(paths.staging, { recursive: true, force: true }) }
    const done = { ...current, pendingMigration: undefined }; await this.options.store.write(done); return done
  }
  private async writeManifests(value: AshBootstrap): Promise<void> { for (const volume of value.volumes) await this.writeManifest(volumeRoot(volume.parentPath), volume, this.groupsFor(value, volume.id), value.generation, 'active') }
  private async writeManifest(root: string, volume: { id: string; name: string; createdAt: string }, groups: StorageGroupId[], generation: number, state: 'active' | 'backup', migrationId?: string): Promise<void> { await writeJsonAtomic(join(root, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state, groups, generation, createdAt: volume.createdAt, updatedAt: new Date().toISOString(), migrationId }) }
  private pathsFor(current: AshBootstrap, previous: AshBootstrap, journal: MigrationJournal): { source: string; final: string; staging: string; backup: string } { if (journal.kind === 'import') throw new Error('Import journal requires per-group paths'); if (journal.kind === 'volume') { const source = volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath); const final = volumeRoot(journal.targetParentPath!); return { source, final, staging: join(dirname(final), `${basename(final)}.migrating-${journal.id}`), backup: source } } const group = journal.groups[0]; const source = join(volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath), group); const final = join(volumeRoot(this.volume(current, journal.targetVolumeId!).parentPath), group); return { source, final, staging: join(volumeRoot(this.volume(current, journal.targetVolumeId!).parentPath), '.ash-staging', journal.id, group), backup: join(volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath), '.ash-backups', journal.id, group) } }
}
