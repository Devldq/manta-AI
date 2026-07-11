import { randomUUID, createHash } from 'node:crypto'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AshBootstrap, AshLocationSnapshot, MigrationJournal, MigrationPhase, StorageGroupId, StorageOperationProgress } from '@manta/shared'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { writeJsonAtomic } from '../bootstrap/atomic-json'
import { volumeRoot } from '../domain/invariants'
import { inventoryTree, type StorageInventory } from '../inventory/file-inventory'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { copyTree } from './copy-tree'
import type { MigrationFaultPoint, ProgressHandler, StorageGroupDriver } from './types'

const MIN_MARGIN = 256 * 1024 * 1024
const snapshot = (value: AshBootstrap): AshLocationSnapshot => ({ generation: value.generation, volumes: value.volumes, groupAssignments: value.groupAssignments })
const digestInventory = (value: StorageInventory): string => createHash('sha256').update(JSON.stringify(value.entries)).digest('hex')

export interface MigrationCoordinatorOptions {
  store: BootstrapStore
  leases: StorageLeaseManager
  drivers: Map<StorageGroupId, StorageGroupDriver>
  availableBytes?: (targetPath: string) => Promise<number>
  fault?: (point: MigrationFaultPoint) => Promise<void>
  onProgress?: ProgressHandler
  leaseTimeoutMs?: number
}

export class MigrationCoordinator {
  private running = false
  constructor(private readonly options: MigrationCoordinatorOptions) {}

  async relocateVolume(volumeId: string, targetParentPath: string): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const volume = current.volumes.find((item) => item.id === volumeId)
      if (!volume) throw new Error(`Unknown volume ${volumeId}`)
      const groups = (Object.entries(current.groupAssignments).filter(([, id]) => id === volumeId).map(([group]) => group)) as StorageGroupId[]
      const sourceRoot = volumeRoot(volume.parentPath); const finalRoot = volumeRoot(targetParentPath); const id = randomUUID(); const staging = join(dirname(finalRoot), `${basename(finalRoot)}.migrating-${id}`)
      await this.ensureAbsent(finalRoot)
      const sourceInventory = await inventoryTree(sourceRoot); await this.ensureCapacity(targetParentPath, sourceInventory.bytes)
      let journal = this.journal(id, 'volume', volumeId, groups, current, { targetParentPath }, sourceInventory)
      await this.persistJournal(current, journal)
      let committed = false
      const lease = await this.options.leases.acquireExclusive(groups, { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 })
      try {
        journal = await this.phase(current, journal, 'quiescing')
        await Promise.all(groups.map((group) => this.driver(group).quiesce()))
        await Promise.all(groups.map((group) => this.driver(group).checkpoint()))
        await Promise.all(groups.map((group) => this.driver(group).close()))
        journal = await this.phase(current, journal, 'copying'); await this.options.fault?.('copying')
        await copyTree(sourceRoot, staging, sourceInventory, (files, bytes) => { journal.filesCompleted = files; journal.bytesCompleted = bytes; this.progress(journal, 'copying') })
        journal = await this.phase(current, journal, 'validating'); await this.options.fault?.('validating')
        await this.validateCopy(sourceInventory, staging, groups)
        await rename(staging, finalRoot)
        await this.writeManifest(finalRoot, volume, groups, current.generation + 1, 'active')
        await this.options.fault?.('before-bootstrap-commit')
        journal = { ...journal, phase: 'committing' }; const next = this.committedBootstrap(current, journal, { volumes: current.volumes.map((item) => item.id === volumeId ? { ...item, parentPath: targetParentPath, updatedAt: new Date().toISOString() } : item) })
        await this.options.store.write(next); committed = true; this.progress(journal, 'committing')
        await this.options.fault?.('after-bootstrap-commit')
        await this.verifyAndFinish(next, journal, groups)
        await this.writeManifest(sourceRoot, volume, groups, current.generation, 'backup', id)
        return id
      } catch (error) {
        if (committed) await this.rollback(current, groups)
        else { await this.options.store.write(current); await this.isolate(staging, finalRoot, id) }
        throw error
      } finally { lease.release() }
    })
  }

  async moveGroup(group: StorageGroupId, targetVolumeId: string): Promise<string> {
    return this.transaction(async () => {
      const current = await this.requiredBootstrap(); const sourceVolumeId = current.groupAssignments[group]
      if (sourceVolumeId === targetVolumeId) throw new Error(`${group} is already assigned to ${targetVolumeId}`)
      const source = current.volumes.find((item) => item.id === sourceVolumeId); const target = current.volumes.find((item) => item.id === targetVolumeId)
      if (!source || !target) throw new Error('Source or target volume does not exist')
      const sourcePath = join(volumeRoot(source.parentPath), group); const targetPath = join(volumeRoot(target.parentPath), group); await this.ensureAbsent(targetPath)
      const id = randomUUID(); const staging = join(volumeRoot(target.parentPath), '.ash-staging', id, group); const inventory = await inventoryTree(sourcePath); await this.ensureCapacity(target.parentPath, inventory.bytes)
      let journal = this.journal(id, 'group', sourceVolumeId, [group], current, { targetVolumeId }, inventory); await this.persistJournal(current, journal)
      let committed = false; const lease = await this.options.leases.acquireExclusive([group], { timeoutMs: this.options.leaseTimeoutMs ?? 30_000 })
      try {
        journal = await this.phase(current, journal, 'quiescing'); const driver = this.driver(group); await driver.quiesce(); await driver.checkpoint(); await driver.close()
        journal = await this.phase(current, journal, 'copying'); await this.options.fault?.('copying'); await copyTree(sourcePath, staging, inventory, (files, bytes) => { journal.filesCompleted = files; journal.bytesCompleted = bytes; this.progress(journal, 'copying', group) })
        journal = await this.phase(current, journal, 'validating'); await this.options.fault?.('validating'); await this.validateCopy(inventory, staging, [group], true)
        await mkdir(dirname(targetPath), { recursive: true }); await rename(staging, targetPath)
        const sourceGroups = (Object.entries(current.groupAssignments).filter(([candidate, id]) => id === sourceVolumeId && candidate !== group).map(([candidate]) => candidate)) as StorageGroupId[]
        const targetGroups = (Object.entries(current.groupAssignments).filter(([, id]) => id === targetVolumeId).map(([candidate]) => candidate)) as StorageGroupId[]
        targetGroups.push(group)
        await this.writeManifest(volumeRoot(target.parentPath), target, targetGroups, current.generation + 1, 'active')
        await this.writeManifest(volumeRoot(source.parentPath), source, sourceGroups, current.generation + 1, 'active')
        await this.options.fault?.('before-bootstrap-commit')
        journal = { ...journal, phase: 'committing' }; const assignments = { ...current.groupAssignments, [group]: targetVolumeId }; const next = this.committedBootstrap(current, journal, { groupAssignments: assignments })
        await this.options.store.write(next); committed = true; await this.options.fault?.('after-bootstrap-commit')
        const backup = join(volumeRoot(source.parentPath), '.ash-backups', id, group); await mkdir(dirname(backup), { recursive: true }); await rename(sourcePath, backup)
        await this.verifyAndFinish(next, journal, [group]); return id
      } catch (error) {
        if (committed) await this.rollback(current, [group]); else { await this.options.store.write(current); await this.isolate(staging, targetPath, id) }
        throw error
      } finally { lease.release() }
    })
  }

  async recoverPending(): Promise<AshBootstrap | undefined> {
    const current = await this.options.store.read(); const journal = current?.pendingMigration
    if (!current || !journal) return current
    if (!current.previous) throw new Error('Pending migration has no previous snapshot')
    const restored: AshBootstrap = { schemaVersion: 1, ...current.previous }
    await this.options.store.write(restored)
    return restored
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> { if (this.running) throw new Error('A storage mapping transaction is already in progress'); this.running = true; try { return await operation() } finally { this.running = false } }
  private async requiredBootstrap(): Promise<AshBootstrap> { const value = await this.options.store.read(); if (!value) throw new Error('Bootstrap does not exist'); if (value.pendingMigration) throw new Error('Pending migration must be recovered first'); return value }
  private driver(group: StorageGroupId): StorageGroupDriver { const value = this.options.drivers.get(group); if (!value) throw new Error(`Missing storage driver for ${group}`); return value }
  private journal(id: string, kind: 'volume' | 'group', sourceVolumeId: string, groups: StorageGroupId[], current: AshBootstrap, target: Pick<MigrationJournal, 'targetVolumeId' | 'targetParentPath'>, inventory: StorageInventory): MigrationJournal { return { id, kind, sourceVolumeId, ...target, groups, sourceGeneration: current.generation, targetGeneration: current.generation + 1, phase: 'planned', filesCompleted: 0, filesTotal: inventory.files, bytesCompleted: 0, bytesTotal: inventory.bytes, manifestDigest: digestInventory(inventory) } }
  private async persistJournal(current: AshBootstrap, journal: MigrationJournal): Promise<void> { await this.options.store.write({ ...current, generation: journal.targetGeneration, previous: snapshot(current), pendingMigration: journal }); this.progress(journal, journal.phase) }
  private async phase(current: AshBootstrap, journal: MigrationJournal, phase: MigrationPhase): Promise<MigrationJournal> { const next = { ...journal, phase }; await this.persistJournal(current, next); return next }
  private committedBootstrap(current: AshBootstrap, journal: MigrationJournal, changes: Partial<AshBootstrap>): AshBootstrap { return { ...current, ...changes, generation: journal.targetGeneration, previous: snapshot(current), pendingMigration: journal } }
  private progress(journal: MigrationJournal, phase: string, currentGroup?: StorageGroupId): void { const value: StorageOperationProgress = { operationId: journal.id, phase, currentGroup, filesCompleted: journal.filesCompleted, filesTotal: journal.filesTotal, bytesCompleted: journal.bytesCompleted, bytesTotal: journal.bytesTotal, message: phase }; this.options.onProgress?.(value) }
  private async ensureCapacity(target: string, sourceBytes: number): Promise<void> { const available = await (this.options.availableBytes?.(target) ?? Promise.resolve(Number.MAX_SAFE_INTEGER)); const required = sourceBytes + Math.max(Math.ceil(sourceBytes * 0.1), MIN_MARGIN); if (available < required) throw new Error(`Insufficient space: ${required} bytes required`) }
  private async ensureAbsent(path: string): Promise<void> { try { await access(path); throw new Error(`Migration target already exists: ${path}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  private async validateCopy(expected: StorageInventory, target: string, groups: StorageGroupId[], groupRoot = false): Promise<void> { const actual = await inventoryTree(target); if (digestInventory(expected) !== digestInventory(actual)) throw new Error('Copied inventory does not match source'); for (const group of groups) { const result = await this.driver(group).validate(groupRoot ? target : join(target, group)); if (!result.ok) throw new Error(result.error ?? `Validation failed for ${group}`) } }
  private async verifyAndFinish(value: AshBootstrap, journal: MigrationJournal, groups: StorageGroupId[]): Promise<void> { let next: MigrationJournal = { ...journal, phase: 'verifying' }; await this.options.store.write({ ...value, pendingMigration: next }); for (const group of groups) { const bootstrap = await this.options.store.read(); if (!bootstrap) throw new Error('Bootstrap disappeared'); const volume = bootstrap.volumes.find((item) => item.id === bootstrap.groupAssignments[group]); if (!volume) throw new Error(`Missing volume for ${group}`); const root = join(volumeRoot(volume.parentPath), group); await this.driver(group).reopen(root); const result = await this.driver(group).validate(root); if (!result.ok) throw new Error(result.error ?? `Post-commit validation failed for ${group}`) } next = { ...next, phase: 'completed' }; await this.options.store.write({ ...value, pendingMigration: next }); this.progress(next, 'completed'); await this.options.store.write({ ...value, pendingMigration: undefined }) }
  private async rollback(current: AshBootstrap, groups: StorageGroupId[]): Promise<void> { await this.options.store.write(current); for (const group of groups) { const volume = current.volumes.find((item) => item.id === current.groupAssignments[group]); if (volume) await this.driver(group).reopen(join(volumeRoot(volume.parentPath), group)) } }
  private async isolate(staging: string, finalPath: string, id: string): Promise<void> { for (const candidate of [staging, finalPath]) { try { await rename(candidate, `${candidate}.failed-${id}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await rm(candidate, { recursive: true, force: true }) } } }
  private async writeManifest(root: string, volume: { id: string; name: string; createdAt: string }, groups: StorageGroupId[], generation: number, state: 'active' | 'backup', migrationId?: string): Promise<void> { await writeJsonAtomic(join(root, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state, groups, generation, createdAt: volume.createdAt, updatedAt: new Date().toISOString(), migrationId }) }
}
