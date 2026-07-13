import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { volumeRoot } from '../domain/invariants'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { MigrationCoordinator } from '../migration/migration-coordinator'
import type { StorageGroupDriver } from '../migration/types'
import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'
import type { AshBootstrap, StorageVolumeRecord } from '@manta/shared'

const liveDriver = (id: StorageGroupId): StorageGroupDriver => ({
  id,
  async quiesce() {}, async checkpoint() {}, async close() {}, async reopen() {},
  async validate(root) { await access(root); return { ok: true } },
  async inventory(root) { return (await import('../inventory/file-inventory')).inventoryTree(root) },
})

async function createVolume(store: BootstrapStore, parentPath: string, id: string, name = 'Default'): Promise<StorageVolumeRecord> {
  const now = new Date().toISOString()
  const volume = { id, name, parentPath, createdAt: now, updatedAt: now }
  for (const group of STORAGE_GROUP_IDS) await mkdir(join(volumeRoot(parentPath), group), { recursive: true })
  await store.write({ schemaVersion: 1, generation: 1, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((group) => [group, id])) as AshBootstrap['groupAssignments'] })
  return volume
}

describe('ASH Phase 1 storage-foundation acceptance', () => {
  it('routes exactly seven groups below the selected .manta-ai parent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-accept-first-launch-'))
    const bootstrapPath = join(parent, 'user-data', 'ash-bootstrap.json')
    const store = new BootstrapStore(bootstrapPath)
    const volume = await createVolume(store, parent, 'first')
    expect((await store.read())?.groupAssignments).toEqual(Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])))
    for (const group of STORAGE_GROUP_IDS) await expect(access(join(parent, '.manta-ai', group))).resolves.toBeUndefined()
    expect((await new BootstrapStore(bootstrapPath).read())?.volumes[0].parentPath).toBe(parent)
  })

  it('moves a group, preserves a source backup, and routes subsequent writes only to its new volume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-accept-group-'))
    const firstParent = join(root, 'first'); const secondParent = join(root, 'second'); const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const store = new BootstrapStore(bootstrapPath)
    const initialized = await createVolume(store, firstParent, 'first')
    await writeFile(join(volumeRoot(firstParent), 'work', 'session.json'), '{"session":1}')
    const secondVolumeId = 'second'; const second = { ...initialized, id: secondVolumeId, name: 'Work', parentPath: secondParent }
    await mkdir(join(volumeRoot(secondParent), '.ash-backups'), { recursive: true })
    await store.update((current) => ({ ...current, generation: current.generation + 1, volumes: [...current.volumes, second] }))
    const coordinator = new MigrationCoordinator({ store, leases: new StorageLeaseManager(), drivers: new Map([['work', liveDriver('work')]]), availableBytes: async () => Number.MAX_SAFE_INTEGER })
    const operationId = await coordinator.moveGroup('work', secondVolumeId)
    const current = await store.read()
    expect(current?.groupAssignments.work).toBe(secondVolumeId)
    await expect(readFile(join(volumeRoot(secondParent), 'work', 'session.json'), 'utf8')).resolves.toContain('session')
    await expect(readFile(join(volumeRoot(firstParent), '.ash-backups', operationId, 'work', 'session.json'), 'utf8')).resolves.toContain('session')
    await writeFile(join(volumeRoot(secondParent), 'work', 'after-move.txt'), 'new')
    await expect(access(join(volumeRoot(firstParent), 'work', 'after-move.txt'))).rejects.toThrow()
    expect(initialized.id).not.toBe(secondVolumeId)
  })

  it.each(['copying', 'validating', 'before-bootstrap-commit', 'after-bootstrap-commit'] as const)('keeps a recoverable source mapping when a volume migration crashes at %s', async (point) => {
    const root = await mkdtemp(join(tmpdir(), 'ash-accept-recovery-'))
    const source = join(root, 'source'); const target = join(root, 'target'); const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const store = new BootstrapStore(bootstrapPath)
    const initialized = await createVolume(store, source, 'first')
    await writeFile(join(volumeRoot(source), 'config', 'state.json'), '{"safe":true}')
    const coordinator = new MigrationCoordinator({
      store, leases: new StorageLeaseManager(), drivers: new Map(STORAGE_GROUP_IDS.map((id) => [id, liveDriver(id)])), availableBytes: async () => Number.MAX_SAFE_INTEGER,
      fault: async (at) => { if (at === point) throw new Error(`intentional crash at ${at}`) },
    })
    await expect(coordinator.relocateVolume(initialized.id, target)).rejects.toThrow('intentional crash')
    const recovered = await coordinator.recoverPending()
    expect(recovered?.volumes[0].parentPath).toBe(source)
    await expect(readFile(join(volumeRoot(source), 'config', 'state.json'), 'utf8')).resolves.toContain('safe')
  })
})
