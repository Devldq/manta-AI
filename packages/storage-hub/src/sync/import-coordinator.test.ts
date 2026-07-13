import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { ImportCoordinator } from './import-coordinator'

const directories: string[] = []
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-import-')); directories.push(value); return value }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('ImportCoordinator', () => {
  it('validates a fetched staging manifest before an accepted remote group replaces live data', async () => {
    const live = await directory(); const staging = await directory(); const leases = new StorageLeaseManager(); const calls: string[] = []
    await mkdir(join(live, 'work'), { recursive: true }); await writeFile(join(live, 'work', 'task.txt'), 'local')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const coordinator = new ImportCoordinator({
      leases,
      resolveGroupRoot: () => join(live, 'work'),
      replaceGroup: async (group, source) => { calls.push(`${group}:${source}`) },
    })

    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: 'f'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, decisions: { work: 'keep-remote' } })).rejects.toThrow(/hash/i)
    await expect(readFile(join(live, 'work', 'task.txt'), 'utf8')).resolves.toBe('local')
    expect(calls).toEqual([])
  })

  it('takes an exclusive lease and rolls back an accepted group replacement failure', async () => {
    const live = await directory(); const staging = await directory(); const leases = new StorageLeaseManager(); const events: string[] = []
    await mkdir(join(live, 'work'), { recursive: true }); await writeFile(join(live, 'work', 'task.txt'), 'local')
    await mkdir(join(staging, 'work'), { recursive: true }); await writeFile(join(staging, 'work', 'task.txt'), 'remote')
    const coordinator = new ImportCoordinator({
      leases,
      resolveGroupRoot: () => join(live, 'work'),
      replaceGroup: async () => { events.push('replace'); throw new Error('failed after copy') },
      restoreGroup: async () => { events.push('restore') },
      hashGroup: async () => 'a'.repeat(64),
    })

    await expect(coordinator.apply({ volumeId: 'v1', stagingRoot: staging, manifest: { schemaVersion: 1, volumeId: 'v1', generation: 1, groupHashes: { work: 'a'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, decisions: { work: 'keep-remote' } })).rejects.toThrow('failed after copy')
    expect(events).toEqual(['replace', 'restore'])
  })
})
