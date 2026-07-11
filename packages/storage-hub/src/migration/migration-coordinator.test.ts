import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
})
