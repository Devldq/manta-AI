import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetManifestStore } from './manifest-store'
import { VolumeContentGarbageCollector } from './garbage-collector'
import { VolumeObjectStore } from './object-store'
import { measureVolumeCapacity } from './capacity-metrics'

const roots: string[] = []
async function root() { const value = await mkdtemp(join(tmpdir(), 'ash-capacity-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))) })
const pending = async () => ({ complete: true as const })
const allocated = (value: number) => () => ({ allocatedBytes: value, evidence: 'verified-test' })

describe('read-only volume capacity metrics', () => {
  it('expands repeated manifest references while counting a volume-local CAS object once', async () => {
    const volumeRoot = await root(); const object = await new VolumeObjectStore(volumeRoot).ingestBytes(Buffer.from('same'))
    await new AssetManifestStore(volumeRoot).write({ assetId: 'a', entries: [{ path: 'one', hash: object.hash, size: object.size }, { path: 'two', hash: object.hash, size: object.size }] })
    const result = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: allocated(3) })
    expect(result).toMatchObject({ scanStatus: 'complete', logicalImmutableBytes: 8, physicalImmutableBytes: 3, verifiedDedupSavedBytes: 5 })
  })

  it('does not merge identical hashes across volume measurements', async () => {
    const first = await root(); const second = await root()
    for (const volumeRoot of [first, second]) { const object = await new VolumeObjectStore(volumeRoot).ingestBytes(Buffer.from('same')); await new AssetManifestStore(volumeRoot).write({ assetId: 'a', entries: [{ path: 'one', hash: object.hash, size: object.size }] }) }
    const results = await Promise.all([measureVolumeCapacity(first, { volumeId: 'v1', pending, allocation: allocated(3) }), measureVolumeCapacity(second, { volumeId: 'v2', pending, allocation: allocated(3) })])
    expect(results.map((item) => item.physicalImmutableBytes)).toEqual([3, 3])
  })

  it('degrades with null physical and savings when allocation evidence is unavailable', async () => {
    const volumeRoot = await root(); await new VolumeObjectStore(volumeRoot).ingestBytes(Buffer.from('same'))
    const result = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: () => ({ allocatedBytes: null, evidence: 'unavailable' }) })
    expect(result).toMatchObject({ scanStatus: 'degraded', physicalImmutableBytes: null, verifiedDedupSavedBytes: null })
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'allocation-unavailable' }))
  })

  it('recomputes instead of returning stale measurements', async () => {
    const volumeRoot = await root(); const first = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: allocated(1) })
    await new VolumeObjectStore(volumeRoot).ingestBytes(Buffer.from('later'))
    const second = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: allocated(1) })
    expect(first.physicalImmutableBytes).toBe(0); expect(second.physicalImmutableBytes).toBe(1); expect(second.scannedAt >= first.scannedAt).toBe(true)
  })

  it('reads verified unchanged GC candidates without running collection or deleting objects', async () => {
    const volumeRoot = await root(); const object = await new VolumeObjectStore(volumeRoot).ingestBytes(Buffer.from('orphan'))
    await new VolumeContentGarbageCollector(volumeRoot, { pending, allocation: allocated(7) }).scan()
    const result = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: allocated(7) })
    expect(result.cleanableBytes).toBe(7); await expect(import('node:fs/promises').then(({ readFile }) => readFile(object.path, 'utf8'))).resolves.toBe('orphan')
  })

  it('labels replica trees separately and never subtracts them into savings', async () => {
    const volumeRoot = await root(); await mkdir(join(volumeRoot, '.ash', 'sync'), { recursive: true }); await writeFile(join(volumeRoot, '.ash', 'sync', 'snapshot'), 'replica')
    const result = await measureVolumeCapacity(volumeRoot, { volumeId: 'v1', pending, allocation: allocated(1) })
    expect(result).toMatchObject({ replicaBytes: 7, logicalImmutableBytes: 0, verifiedDedupSavedBytes: 0 })
  })
})
