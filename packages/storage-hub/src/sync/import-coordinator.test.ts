import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { volumeRoot } from '../domain/invariants'
import { MigrationCoordinator } from '../migration/migration-coordinator'
import type { StorageGroupDriver } from '../migration/types'
import { ImportCoordinator, hashSyncGroup } from './import-coordinator'

const directories: string[] = []
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-import-')); directories.push(value); return value }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('ImportCoordinator', () => {
  it('delegates to the real migration replacement without recursively deadlocking its exclusive lease', async () => {
    const parent = await directory(); const staging = await directory(); const store = new BootstrapStore(join(parent, 'bootstrap.json')); const leases = new StorageLeaseManager(); const now = new Date().toISOString()
    const groupAssignments = Object.fromEntries(['extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache'].map((group) => [group, 'v1'])) as any
    await store.write({ schemaVersion: 1, generation: 1, volumes: [{ id: 'v1', name: 'default', parentPath: parent, createdAt: now, updatedAt: now }], groupAssignments })
    const live = join(volumeRoot(parent), 'work'); await mkdir(live, { recursive: true }); await writeFile(join(live, 'task.txt'), 'local')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const driver: StorageGroupDriver = { id: 'work', quiesce: async () => {}, checkpoint: async () => {}, close: async () => {}, reopen: async () => {}, validate: async () => ({ ok: true }), inventory: async (root) => import('../inventory/file-inventory').then(({ inventoryTree }) => inventoryTree(root)) }
    const migration = new MigrationCoordinator({ store, leases, drivers: new Map([['work', driver]]), leaseTimeoutMs: 20 })
    let writerEntered = false; let pendingWriter: Promise<import('../runtime/lease-manager').StorageLease> | undefined
    const coordinator = new ImportCoordinator({
      resolveGroupRoot: () => live,
      replaceGroups: async (groups, preflight) => { await migration.replaceGroupsFromStaging(groups, 'import-no-deadlock', preflight) },
      hashGroup: async (root) => {
        if (root === live) { pendingWriter = leases.acquireWrite('work').then((lease) => { writerEntered = true; return lease }); await Promise.resolve(); expect(writerEntered).toBe(false) }
        return hashSyncGroup(root)
      },
    })
    const [remoteHash, localHash] = await Promise.all([hashSyncGroup(join(staging, 'work')), hashSyncGroup(live)])

    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: remoteHash }, createdAt: now }, decisions: { work: 'keep-remote' }, expectedLocalHashes: { work: localHash } })).resolves.toBeUndefined()
    await expect(readFile(join(live, 'task.txt'), 'utf8')).resolves.toBe('remote')
    const writer = await pendingWriter!; expect(writerEntered).toBe(true); writer.release()
  })

  it('validates a fetched staging manifest before an accepted remote group replaces live data', async () => {
    const live = await directory(); const staging = await directory(); const calls: string[] = []
    await mkdir(join(live, 'work'), { recursive: true }); await writeFile(join(live, 'work', 'task.txt'), 'local')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const coordinator = new ImportCoordinator({
      resolveGroupRoot: () => join(live, 'work'),
      replaceGroups: async (groups, preflight) => { await preflight(); calls.push(...groups.map(({ group, source }) => `${group}:${source}`)) },
    })

    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: 'f'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, decisions: { work: 'keep-remote' } })).rejects.toThrow(/hash/i)
    await expect(readFile(join(live, 'work', 'task.txt'), 'utf8')).resolves.toBe('local')
    expect(calls).toEqual([])
  })

  it('takes an exclusive lease and delegates selected groups to one rollback-capable replacement', async () => {
    const live = await directory(); const staging = await directory(); const events: string[] = []
    await mkdir(join(live, 'work'), { recursive: true }); await writeFile(join(live, 'work', 'task.txt'), 'local')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const coordinator = new ImportCoordinator({
      resolveGroupRoot: () => join(live, 'work'),
      replaceGroups: async (_groups, preflight) => { await preflight(); events.push('replace'); throw new Error('failed after copy') },
      hashGroup: async () => 'a'.repeat(64),
    })

    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, decisions: { work: 'keep-remote' } })).rejects.toThrow('failed after copy')
    expect(events).toEqual(['replace'])
  })

  it('rejects a TOCTOU local modification while it holds the replacement lease', async () => {
    const live = await directory(); const staging = await directory(); const calls: string[] = []
    await mkdir(join(live, 'work'), { recursive: true }); await writeFile(join(live, 'work', 'task.txt'), 'changed-after-plan')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const localRoot = join(live, 'work')
    const coordinator = new ImportCoordinator({ resolveGroupRoot: () => localRoot, replaceGroups: async (_groups, preflight) => { await preflight(); calls.push('replace') }, hashGroup: async (root) => root === localRoot ? 'c'.repeat(64) : 'a'.repeat(64) })
    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, decisions: { work: 'keep-remote' }, expectedLocalHashes: { work: 'b'.repeat(64) } })).rejects.toThrow(/changed after.*planned/i)
    expect(calls).toEqual([])
  })
})
