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

export class MigrationCoordinator {
  private running = false
  constructor(private readonly options: MigrationCoordinatorOptions) {}

  async relocateVolume(volumeId: string, targetParentPath: string): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const volume = this.volume(current, volumeId); const groups = this.groupsFor(current, volumeId)
      const sourceRoot = volumeRoot(volume.parentPath); const finalRoot = volumeRoot(targetParentPath); await this.rejectOverlap(sourceRoot, finalRoot); await this.ensureAbsent(finalRoot)
      const id = randomUUID(); const staging = join(dirname(finalRoot), `${basename(finalRoot)}.migrating-${id}`); const inventory = await inventoryTree(sourceRoot); await this.ensureCapacity(targetParentPath, inventory.bytes)
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

  async moveGroup(group: StorageGroupId, targetVolumeId: string): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const sourceVolumeId = current.groupAssignments[group]; if (sourceVolumeId === targetVolumeId) throw new Error(`${group} is already assigned to ${targetVolumeId}`)
      const source = this.volume(current, sourceVolumeId); const target = this.volume(current, targetVolumeId); const sourcePath = join(volumeRoot(source.parentPath), group); const targetPath = join(volumeRoot(target.parentPath), group); await this.rejectOverlap(sourcePath, targetPath); await this.ensureAbsent(targetPath)
      const id = randomUUID(); const staging = join(volumeRoot(target.parentPath), '.ash-staging', id, group); const backup = join(volumeRoot(source.parentPath), '.ash-backups', id, group); const inventory = await inventoryTree(sourcePath); await this.ensureCapacity(target.parentPath, inventory.bytes)
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

  async recoverPending(): Promise<AshBootstrap | undefined> {
    const lock = await acquireMigrationFileLock(this.options.store.filePath, true)
    try {
      const current = await this.options.store.read(); const journal = current?.pendingMigration; if (!current || !journal) return current; if (!current.previous) throw new Error('Pending migration has no previous snapshot')
      const previous: AshBootstrap = { schemaVersion: 1, ...current.previous }; const paths = this.pathsFor(current, previous, journal)
      if (PRECOMMIT.has(journal.phase)) { await this.isolate(paths.staging, paths.final, journal.id); await this.writeManifests(previous); await this.reopen(previous, journal.groups); await this.options.store.write(previous); return previous }
      try {
        await this.verifyTargets(current, journal, journal.groups)
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
  private progress(journal: MigrationJournal, phase: string, currentGroup?: StorageGroupId): void { const value: StorageOperationProgress = { operationId: journal.id, phase, currentGroup, filesCompleted: journal.filesCompleted, filesTotal: journal.filesTotal, bytesCompleted: journal.bytesCompleted, bytesTotal: journal.bytesTotal, message: phase }; this.options.onProgress?.(value) }
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
  private async writeManifests(value: AshBootstrap): Promise<void> { for (const volume of value.volumes) await this.writeManifest(volumeRoot(volume.parentPath), volume, this.groupsFor(value, volume.id), value.generation, 'active') }
  private async writeManifest(root: string, volume: { id: string; name: string; createdAt: string }, groups: StorageGroupId[], generation: number, state: 'active' | 'backup', migrationId?: string): Promise<void> { await writeJsonAtomic(join(root, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state, groups, generation, createdAt: volume.createdAt, updatedAt: new Date().toISOString(), migrationId }) }
  private pathsFor(current: AshBootstrap, previous: AshBootstrap, journal: MigrationJournal): { source: string; final: string; staging: string; backup: string } { if (journal.kind === 'volume') { const source = volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath); const final = volumeRoot(journal.targetParentPath!); return { source, final, staging: join(dirname(final), `${basename(final)}.migrating-${journal.id}`), backup: source } } const group = journal.groups[0]; const source = join(volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath), group); const final = join(volumeRoot(this.volume(current, journal.targetVolumeId!).parentPath), group); return { source, final, staging: join(volumeRoot(this.volume(current, journal.targetVolumeId!).parentPath), '.ash-staging', journal.id, group), backup: join(volumeRoot(this.volume(previous, journal.sourceVolumeId).parentPath), '.ash-backups', journal.id, group) } }
}
