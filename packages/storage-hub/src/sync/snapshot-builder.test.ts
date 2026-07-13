import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageLeaseManager } from '../runtime/lease-manager'
import { buildVolumeSnapshot } from './snapshot-builder'

const directories: string[] = []
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-snapshot-')); directories.push(value); return value }
afterEach(async () => { await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))) })

describe('buildVolumeSnapshot', () => {
  it('copies only persistent groups, checkpoints SQLite, excludes WAL and writes full group hashes', async () => {
    const root = await directory(); const cache = await directory(); const leases = new StorageLeaseManager(); const checkpoints: string[] = []
    await mkdir(join(root, 'knowledge'), { recursive: true }); await mkdir(join(root, 'work'), { recursive: true }); await mkdir(join(root, 'secrets'), { recursive: true })
    await writeFile(join(root, 'knowledge', 'rag.sqlite'), 'consistent database')
    await writeFile(join(root, 'knowledge', 'rag.sqlite-wal'), 'transient wal')
    await writeFile(join(root, 'work', 'task.json'), '{"ok":true}')
    await writeFile(join(root, 'secrets', 'secret.txt'), 'never sync')

    const snapshot = await buildVolumeSnapshot({ volumeId: 'volume-1', generation: 7, volumeRoot: root, cachePath: cache, leases, checkpoint: async (group) => { checkpoints.push(group) } })

    expect(checkpoints).toEqual(expect.arrayContaining(['knowledge']))
    await expect(readFile(join(cache, 'knowledge', 'rag.sqlite'), 'utf8')).resolves.toBe('consistent database')
    await expect(readFile(join(cache, 'knowledge', 'rag.sqlite-wal'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(cache, 'secrets', 'secret.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(snapshot.groupHashes).toEqual(expect.objectContaining({ knowledge: expect.stringMatching(/^[a-f0-9]{64}$/), work: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    expect(snapshot.groupHashes).not.toHaveProperty('secrets')
    expect(snapshot).toMatchObject({ volumeId: 'volume-1', generation: 7 })
  })
})
