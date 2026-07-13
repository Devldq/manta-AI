import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AshBootstrap, StorageGroupId } from '@manta/shared'
import { describe, expect, it } from 'vitest'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { volumeRoot } from '../domain/invariants'
import { StorageLeaseManager } from '../runtime/lease-manager'
import type { StorageGroupDriver } from './types'
import { MigrationCoordinator } from './migration-coordinator'

const groups: StorageGroupId[] = ['extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache']
const now = new Date().toISOString()
const bootstrap = (parentPath: string): AshBootstrap => ({ schemaVersion: 1, generation: 1, volumes: [{ id: 'v1', name: 'default', parentPath, createdAt: now, updatedAt: now }], groupAssignments: Object.fromEntries(groups.map((group) => [group, 'v1'])) as Record<StorageGroupId, string> })
const driver = (id: StorageGroupId): StorageGroupDriver => ({ id, quiesce: async () => {}, checkpoint: async () => {}, close: async () => {}, validate: async () => ({ ok: true }), reopen: async () => {}, inventory: async (root) => import('../inventory/file-inventory').then(({ inventoryTree }) => inventoryTree(root)) })

async function fixture(failAt?: string) {
  const root = await mkdtemp(join(tmpdir(), 'ash-migrate-'))
  const source = join(root, 'source'); const target = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json'))
  const initial = bootstrap(source); await store.write(initial)
  for (const group of groups) { await mkdir(join(volumeRoot(source), group), { recursive: true }); await writeFile(join(volumeRoot(source), group, `${group}.txt`), group) }
  const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])), availableBytes: async () => Number.MAX_SAFE_INTEGER, fault: async (point) => { if (point === failAt) throw new Error(`injected ${point}`) } })
  return { coordinator, initial, source, store, target }
}

describe('MigrationCoordinator', () => {
  it.each(['copying', 'validating', 'before-bootstrap-commit'])('keeps mapping and isolates staging after %s failure', async (point) => {
    const { coordinator, initial, store, target } = await fixture(point)
    await expect(coordinator.relocateVolume('v1', target)).rejects.toThrow(/injected/)
    expect((await store.read())?.groupAssignments).toEqual(initial.groupAssignments)
    await expect(access(join(target, '.manta-ai'))).rejects.toThrow()
  })

  it('restores previous mapping after post-commit verification failure and keeps source backup', async () => {
    const { coordinator, source, store, target } = await fixture('after-bootstrap-commit')
    await expect(coordinator.relocateVolume('v1', target)).rejects.toThrow(/injected/)
    expect((await store.read())?.volumes[0].parentPath).toBe(source)
    expect(await readFile(join(volumeRoot(source), 'work', 'work.txt'), 'utf8')).toBe('work')
  })

  it('commits a relocation, emits byte progress, and clears the pending transaction', async () => {
    const { coordinator, store, target } = await fixture()
    await coordinator.relocateVolume('v1', target)
    const current = await store.read()
    expect(current?.volumes[0].parentPath).toBe(target)
    expect(current?.pendingMigration).toBeUndefined()
    expect(await readFile(join(volumeRoot(target), 'work', 'work.txt'), 'utf8')).toBe('work')
  })

  it('uses a caller-provided operation id for the durable migration journal', async () => {
    const { coordinator, target } = await fixture()
    const operationId = '00000000-0000-4000-8000-000000000001'
    await expect(coordinator.relocateVolume('v1', target, operationId)).resolves.toBe(operationId)
  })

  it('moves one group and retains its source as a transaction backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-group-')); const source = join(root, 'source'); const target = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json'))
    const initial = bootstrap(source); initial.volumes.push({ id: 'v2', name: 'other', parentPath: target, createdAt: now, updatedAt: now }); await store.write(initial)
    await mkdir(join(volumeRoot(source), 'work'), { recursive: true }); await mkdir(volumeRoot(target), { recursive: true }); await writeFile(join(volumeRoot(source), 'work', 'data'), 'payload')
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map([['work', driver('work')]]), availableBytes: async () => Number.MAX_SAFE_INTEGER })
    const id = await coordinator.moveGroup('work', 'v2')
    expect((await store.read())?.groupAssignments.work).toBe('v2')
    expect(await readFile(join(volumeRoot(source), '.ash-backups', id, 'work', 'data'), 'utf8')).toBe('payload')
    expect(JSON.parse(await readFile(join(volumeRoot(target), 'ash-volume.json'), 'utf8')).groups).toContain('work')
    expect(JSON.parse(await readFile(join(volumeRoot(source), 'ash-volume.json'), 'utf8')).groups).not.toContain('work')
  })

  it('rejects a target without source plus the minimum 256 MiB margin', async () => {
    const { initial, source, store, target } = await fixture()
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])), availableBytes: async () => 256 * 1024 * 1024 })
    await expect(coordinator.relocateVolume('v1', target)).rejects.toThrow(/insufficient space/i)
    expect((await store.read())?.volumes[0].parentPath).toBe(source)
    expect(initial.generation).toBe(1)
  })

  it('cleans planned state when lease acquisition times out and permits retry', async () => {
    const { initial, store, target } = await fixture(); const leases = new StorageLeaseManager(); const writer = await leases.acquireWrite('work')
    const coordinator = new MigrationCoordinator({ store, leases, drivers: new Map(groups.map((group) => [group, driver(group)])), availableBytes: async () => Number.MAX_SAFE_INTEGER, leaseTimeoutMs: 5 })
    await expect(coordinator.relocateVolume('v1', target)).rejects.toThrow(/timed out/i); expect(await store.read()).toEqual(initial); writer.release()
    await expect(coordinator.relocateVolume('v1', target)).resolves.toBeTruthy()
  })

  it('serializes different coordinators sharing the same bootstrap file', async () => {
    const { initial, store, target } = await fixture(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    const drivers = new Map(groups.map((group) => [group, driver(group)])); drivers.set('work', { ...driver('work'), quiesce: () => gate })
    const first = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers, availableBytes: async () => Number.MAX_SAFE_INTEGER })
    const second = new MigrationCoordinator({ store: new BootstrapStore(store.filePath), leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])), availableBytes: async () => Number.MAX_SAFE_INTEGER })
    const running = first.relocateVolume('v1', target); await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(second.relocateVolume('v1', join(target, 'other'))).rejects.toThrow(/transaction.*lock/i); release(); await running; expect(initial.generation).toBe(1)
  })

  it('does not break a live coordinator lock during recovery', async () => {
    const { store, target } = await fixture(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve }); const drivers = new Map(groups.map((group) => [group, driver(group)])); drivers.set('work', { ...driver('work'), quiesce: () => gate })
    const first = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers, availableBytes: async () => Number.MAX_SAFE_INTEGER }); const recovery = new MigrationCoordinator({ store: new BootstrapStore(store.filePath), leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])) })
    const running = first.relocateVolume('v1', target); await new Promise((resolve) => setTimeout(resolve, 20)); await expect(recovery.recoverPending()).rejects.toThrow(/transaction.*lock/i); release(); await running
  })

  it('rejects lexical and symlink aliases nested below the source before inventory copy', async () => {
    const { coordinator, source } = await fixture()
    await expect(coordinator.relocateVolume('v1', join(volumeRoot(source), 'nested'))).rejects.toThrow(/overlap/i)
    const alias = join(source, 'alias'); try { await symlink(volumeRoot(source), alias, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    await expect(coordinator.relocateVolume('v1', alias)).rejects.toThrow(/overlap/i)
  })

  it('validates the committed target before moving the source group into backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-order-')); const source = join(root, 'source'); const target = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json')); const initial = bootstrap(source); initial.volumes.push({ id: 'v2', name: 'other', parentPath: target, createdAt: now, updatedAt: now }); await store.write(initial)
    const sourcePath = join(volumeRoot(source), 'work'); await mkdir(sourcePath, { recursive: true }); await mkdir(volumeRoot(target), { recursive: true }); await writeFile(join(sourcePath, 'data'), 'payload')
    let reopenSawSource = false; const failing = { ...driver('work'), reopen: async () => { reopenSawSource = await access(sourcePath).then(() => true, () => false) }, validate: async (rootPath: string) => rootPath.includes(target) ? { ok: false, error: 'postcommit invalid' } : { ok: true } }
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map([['work', failing]]), availableBytes: async () => Number.MAX_SAFE_INTEGER })
    await expect(coordinator.moveGroup('work', 'v2')).rejects.toThrow('postcommit invalid'); expect(reopenSawSource).toBe(true); expect((await store.read())?.groupAssignments.work).toBe('v1'); await expect(access(sourcePath)).resolves.toBeUndefined()
  })

  it.each(['copying', 'validating', 'before-bootstrap-commit'] as const)('reopens every closed driver at its source after %s failure', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'ash-reopen-')); const source = join(root, 'source'); const target = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json')); await store.write(bootstrap(source))
    const reopened = new Set<StorageGroupId>(); const drivers = new Map<StorageGroupId, StorageGroupDriver>()
    for (const group of groups) { await mkdir(join(volumeRoot(source), group), { recursive: true }); await writeFile(join(volumeRoot(source), group, 'data'), group); drivers.set(group, { ...driver(group), reopen: async (rootPath) => { expect(rootPath).toBe(join(volumeRoot(source), group)); reopened.add(group) } }) }
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers, availableBytes: async () => Number.MAX_SAFE_INTEGER, fault: async (at) => { if (at === point) throw new Error(`original ${point}`) } })
    await expect(coordinator.relocateVolume('v1', target)).rejects.toThrow(`original ${point}`); expect(reopened).toEqual(new Set(groups)); expect((await store.read())?.pendingMigration).toBeUndefined()
  })

  it.each(['planned', 'quiescing', 'copying', 'validating'] as const)('recovers persisted precommit phase %s idempotently', async (phase) => {
    const { initial, source, store, target } = await fixture(); const id = `recover-${phase}`; const final = volumeRoot(target); const staging = join(target, `.manta-ai.migrating-${id}`); await mkdir(phase === 'validating' ? final : staging, { recursive: true }); await writeFile(join(phase === 'validating' ? final : staging, 'orphan'), 'x')
    await store.write({ ...initial, generation: 2, previous: { generation: 1, volumes: initial.volumes, groupAssignments: initial.groupAssignments }, pendingMigration: { id, kind: 'volume', sourceVolumeId: 'v1', targetParentPath: target, groups, sourceGeneration: 1, targetGeneration: 2, phase, filesCompleted: 0, filesTotal: 1, bytesCompleted: 0, bytesTotal: 1 } })
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])) }); expect((await coordinator.recoverPending())?.volumes[0].parentPath).toBe(source); expect((await coordinator.recoverPending())?.pendingMigration).toBeUndefined()
    await expect(access(phase === 'validating' ? final : staging)).rejects.toThrow()
  })

  it.each(['committing', 'restarting', 'verifying', 'completed'] as const)('finishes persisted committed phase %s idempotently', async (phase) => {
    const { initial, source, store, target } = await fixture(); const id = `recover-${phase}`; await mkdir(volumeRoot(target), { recursive: true })
    for (const group of groups) { await mkdir(join(volumeRoot(target), group), { recursive: true }); await writeFile(join(volumeRoot(target), group, `${group}.txt`), group) }
    const next = { ...initial, generation: 2, volumes: initial.volumes.map((volume) => ({ ...volume, parentPath: target })), previous: { generation: 1, volumes: initial.volumes, groupAssignments: initial.groupAssignments }, pendingMigration: { id, kind: 'volume' as const, sourceVolumeId: 'v1', targetParentPath: target, groups, sourceGeneration: 1, targetGeneration: 2, phase, filesCompleted: 7, filesTotal: 7, bytesCompleted: 52, bytesTotal: 52 } }; await store.write(next)
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map(groups.map((group) => [group, driver(group)])) }); expect((await coordinator.recoverPending())?.volumes[0].parentPath).toBe(target); expect((await coordinator.recoverPending())?.pendingMigration).toBeUndefined(); expect(JSON.parse(await readFile(join(volumeRoot(source), 'ash-volume.json'), 'utf8')).state).toBe('backup')
  })

  it.each((['committing', 'restarting', 'verifying', 'completed'] as const).flatMap((phase) => (['source-present', 'backup-present'] as const).map((layout) => [phase, layout] as const)))('recovers committed group phase %s with %s and repairs both manifests idempotently', async (phase, layout) => {
    const root = await mkdtemp(join(tmpdir(), 'ash-group-recover-')); const sourceParent = join(root, 'source'); const targetParent = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json')); const previous = bootstrap(sourceParent); previous.volumes.push({ id: 'v2', name: 'target', parentPath: targetParent, createdAt: now, updatedAt: now })
    const id = `group-${layout}`; const sourcePath = join(volumeRoot(sourceParent), 'work'); const targetPath = join(volumeRoot(targetParent), 'work'); const backup = join(volumeRoot(sourceParent), '.ash-backups', id, 'work'); await mkdir(layout === 'source-present' ? sourcePath : backup, { recursive: true }); await writeFile(join(layout === 'source-present' ? sourcePath : backup, 'data'), 'payload'); await mkdir(targetPath, { recursive: true }); await writeFile(join(targetPath, 'data'), 'payload')
    await writeFile(join(volumeRoot(sourceParent), 'ash-volume.json'), JSON.stringify({ groups: groups })); await writeFile(join(volumeRoot(targetParent), 'ash-volume.json'), JSON.stringify({ groups: [] }))
    const assignments = { ...previous.groupAssignments, work: 'v2' }; await store.write({ ...previous, generation: 2, groupAssignments: assignments, previous: { generation: 1, volumes: previous.volumes, groupAssignments: previous.groupAssignments }, pendingMigration: { id, kind: 'group', sourceVolumeId: 'v1', targetVolumeId: 'v2', groups: ['work'], sourceGeneration: 1, targetGeneration: 2, phase, filesCompleted: 1, filesTotal: 1, bytesCompleted: 7, bytesTotal: 7 } })
    const reopened: string[] = []; const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map([['work', { ...driver('work'), reopen: async (path) => { reopened.push(path) } }]]) }); await coordinator.recoverPending(); await coordinator.recoverPending()
    expect((await store.read())?.groupAssignments.work).toBe('v2'); expect(await readFile(join(backup, 'data'), 'utf8')).toBe('payload'); expect(JSON.parse(await readFile(join(volumeRoot(sourceParent), 'ash-volume.json'), 'utf8')).groups).not.toContain('work'); expect(JSON.parse(await readFile(join(volumeRoot(targetParent), 'ash-volume.json'), 'utf8')).groups).toContain('work'); expect(reopened).toContain(targetPath)
  })

  it('rolls back committed group recovery when target validation fails and repairs partial manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-group-rollback-')); const sourceParent = join(root, 'source'); const targetParent = join(root, 'target'); const store = new BootstrapStore(join(root, 'bootstrap.json')); const previous = bootstrap(sourceParent); previous.volumes.push({ id: 'v2', name: 'target', parentPath: targetParent, createdAt: now, updatedAt: now }); const sourcePath = join(volumeRoot(sourceParent), 'work'); const targetPath = join(volumeRoot(targetParent), 'work'); await mkdir(sourcePath, { recursive: true }); await mkdir(targetPath, { recursive: true }); await writeFile(join(sourcePath, 'data'), 'payload'); await writeFile(join(targetPath, 'data'), 'payload')
    const assignments = { ...previous.groupAssignments, work: 'v2' }; await store.write({ ...previous, generation: 2, groupAssignments: assignments, previous: { generation: 1, volumes: previous.volumes, groupAssignments: previous.groupAssignments }, pendingMigration: { id: 'failed-group', kind: 'group', sourceVolumeId: 'v1', targetVolumeId: 'v2', groups: ['work'], sourceGeneration: 1, targetGeneration: 2, phase: 'committing', filesCompleted: 1, filesTotal: 1, bytesCompleted: 7, bytesTotal: 7 } })
    const reopened: string[] = []; const failing = { ...driver('work'), reopen: async (path: string) => { reopened.push(path) }, validate: async (path: string) => path === targetPath ? { ok: false, error: 'invalid target' } : { ok: true } }; const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map([['work', failing]]) })
    await expect(coordinator.recoverPending()).rejects.toThrow('invalid target'); await expect(coordinator.recoverPending()).resolves.toEqual(expect.objectContaining({ generation: 1 })); expect((await store.read())?.groupAssignments.work).toBe('v1'); await expect(access(sourcePath)).resolves.toBeUndefined(); expect(JSON.parse(await readFile(join(volumeRoot(sourceParent), 'ash-volume.json'), 'utf8')).groups).toContain('work'); expect(JSON.parse(await readFile(join(volumeRoot(targetParent), 'ash-volume.json'), 'utf8')).groups).not.toContain('work'); expect(reopened).toEqual(expect.arrayContaining([targetPath, sourcePath]))
  })
})
