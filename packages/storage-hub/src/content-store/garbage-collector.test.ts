import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetManifestStore } from './manifest-store'
import { VolumeContentGarbageCollector } from './garbage-collector'
import { VolumeObjectStore } from './object-store'

const roots: string[] = []
async function volume(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ash-gc-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('volume content garbage collector', () => {
  const inspected = { pending: async () => ({ complete: true as const }), allocation: (object: { size: number }) => ({ allocatedBytes: object.size, evidence: 'verified-test' }) }

  it('rejects construction without a mandatory pending-operation inspector', async () => {
    const root = await volume()
    expect(() => new VolumeContentGarbageCollector(root, undefined as never)).toThrow(/pending|inspect/i)
  })

  it('quarantines on the first clean scan and deletes the same unchanged object on a later clean scan', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root, inspected)
    const first = await gc.scan(); expect(first.deletedBytes).toBe(0); expect(first.cleanableBytes).toBe(object.size)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('orphan')
    const second = await gc.scan(); expect(second.deletedBytes).toBe(object.size)
    await expect(readFile(object.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never quarantines a manifest or pending referenced object', async () => {
    const root = await volume(); const objects = new VolumeObjectStore(root); const manifestObject = await objects.ingestBytes(Buffer.from('manifest')); const pendingObject = await objects.ingestBytes(Buffer.from('pending'))
    await new AssetManifestStore(root).write({ assetId: 'asset', entries: [{ path: 'asset', hash: manifestObject.hash, size: manifestObject.size }] })
    const result = await new VolumeContentGarbageCollector(root, { pending: async () => ({ complete: true, liveHashes: [pendingObject.hash] }) }).scan()
    expect(result.cleanableBytes).toBe(0); expect(result.deletedBytes).toBe(0)
  })

  it('does not advance or delete candidates during a degraded scan', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root, inspected)
    await gc.scan(); await mkdir(join(root, '.ash', 'assets'), { recursive: true }); await writeFile(join(root, '.ash', 'assets', 'broken.json'), '{')
    const degraded = await gc.scan(); expect(degraded.status).toBe('degraded'); expect(degraded.deletedBytes).toBe(0)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('orphan')
  })

  it('fails closed for malformed quarantine state', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root, inspected)
    await gc.scan(); await writeFile(join(root, '.ash', 'gc', 'quarantine', `${object.hash}.json`), '{')
    const result = await gc.scan(); expect(result.status).toBe('degraded'); expect(result.deletedBytes).toBe(0)
  })

  it('shares the volume lease with a concurrent manifest publisher', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('publish')); const manifests = new AssetManifestStore(root); const gc = new VolumeContentGarbageCollector(root, inspected)
    await gc.scan()
    const [published, collected] = await Promise.all([manifests.write({ assetId: 'asset', entries: [{ path: 'asset', hash: object.hash, size: object.size }] }), gc.scan()])
    expect(published.assetId).toBe('asset'); expect(collected.deletedBytes).toBe(0)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('publish')
  })

  it('returns degraded without advancing candidates when pending inspection throws', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan'))
    await new VolumeContentGarbageCollector(root, inspected).scan()
    const result = await new VolumeContentGarbageCollector(root, { pending: async (): Promise<never> => { throw new Error('journal unreadable') } }).scan()
    expect(result.status).toBe('degraded'); expect(result.deletedBytes).toBe(0)
    expect(result.blockers).toEqual([expect.objectContaining({ code: 'pending-operation', detail: expect.stringMatching(/journal unreadable/) })])
    await expect(readFile(object.path, 'utf8')).resolves.toBe('orphan')
  })

  it('fails closed when the canonical path is replaced after handle hashing but before unlink', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('replace')); await new VolumeContentGarbageCollector(root, inspected).scan()
    let replaced = false
    const result = await new VolumeContentGarbageCollector(root, { ...inspected, beforeDeleteValidation: async (path) => { replaced = true; await rename(path, `${path}.old`); await writeFile(path, 'replace') } }).scan()
    expect(replaced).toBe(true); expect(result.status).toBe('degraded'); expect(result.deletedBytes).toBe(0)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('replace')
  })

  it('reports cleanable allocation as unavailable when a candidate has no verified allocation evidence', async () => {
    const root = await volume(); await new VolumeObjectStore(root).ingestBytes(Buffer.from('unknown'))
    const result = await new VolumeContentGarbageCollector(root, { pending: inspected.pending, allocation: () => ({ allocatedBytes: null, evidence: 'unavailable' }) }).scan()
    expect(result.cleanableBytes).toBeNull()
  })

  it('does not advance quarantine generations when allocation degradation is discovered', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('unknown-generation'))
    await new VolumeContentGarbageCollector(root, { pending: inspected.pending, allocation: () => ({ allocatedBytes: null, evidence: 'unavailable' }) }).scan()
    const next = await new VolumeContentGarbageCollector(root, inspected).scan()
    expect(next.deletedBytes).toBe(0); await expect(readFile(object.path, 'utf8')).resolves.toBe('unknown-generation')
  })

  it('sums only injected verified allocation evidence for cleanable candidates', async () => {
    const root = await volume(); await new VolumeObjectStore(root).ingestBytes(Buffer.from('allocated'))
    const result = await new VolumeContentGarbageCollector(root, { pending: inspected.pending, allocation: () => ({ allocatedBytes: 8192, evidence: 'verified-test' }) }).scan()
    expect(result.cleanableBytes).toBe(8192)
  })

  it('prevalidates every candidate and deletes zero when the second candidate changes identity', async () => {
    const root = await volume(); const store = new VolumeObjectStore(root); const first = await store.ingestBytes(Buffer.from('first')); const second = await store.ingestBytes(Buffer.from('second')); const expected = new Map([[first.hash, 'first'], [second.hash, 'second']]); const objects = [first, second].sort((a, b) => a.hash.localeCompare(b.hash))
    await new VolumeContentGarbageCollector(root, inspected).scan()
    const result = await new VolumeContentGarbageCollector(root, { ...inspected, beforeDeleteValidation: async (path) => { if (path === objects[1]!.path) { await rename(path, `${path}.old`); await writeFile(path, expected.get(objects[1]!.hash)!) } } }).scan()
    expect(result.status).toBe('degraded'); expect(result.deletedBytes).toBe(0); expect(result.deleted).toEqual([])
    await expect(readFile(objects[0]!.path, 'utf8')).resolves.toBe(expected.get(objects[0]!.hash)); await expect(readFile(objects[1]!.path, 'utf8')).resolves.toBe(expected.get(objects[1]!.hash))
  })

  it('converts final validation filesystem errors into a zero-delete degraded result', async () => {
    const root = await volume(); const store = new VolumeObjectStore(root); const objects = [await store.ingestBytes(Buffer.from('one')), await store.ingestBytes(Buffer.from('two'))].sort((a, b) => a.hash.localeCompare(b.hash))
    await new VolumeContentGarbageCollector(root, inspected).scan()
    const result = await new VolumeContentGarbageCollector(root, { ...inspected, beforeDeleteValidation: (path) => { if (path === objects[1]!.path) throw Object.assign(new Error('unreadable'), { code: 'EACCES' }) } }).scan()
    expect(result).toMatchObject({ status: 'degraded', deletedBytes: 0, deleted: [] }); expect(result.blockers[0]?.detail).toMatch(/unreadable|EACCES/i)
    await expect(readFile(objects[0]!.path)).resolves.toBeTruthy(); await expect(readFile(objects[1]!.path)).resolves.toBeTruthy()
  })

  it('degrades with null cleanable bytes when verified allocation addition overflows', async () => {
    const root = await volume(); const store = new VolumeObjectStore(root); await store.ingestBytes(Buffer.from('overflow-one')); await store.ingestBytes(Buffer.from('overflow-two'))
    const result = await new VolumeContentGarbageCollector(root, { pending: inspected.pending, allocation: () => ({ allocatedBytes: Number.MAX_SAFE_INTEGER, evidence: 'verified-test' }) }).scan()
    expect(result).toMatchObject({ status: 'degraded', cleanableBytes: null, deletedBytes: 0, deleted: [] })
  })

  it('does not delete when the selected candidate allocation is not a safe integer', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('unsafe-delete')); await new VolumeContentGarbageCollector(root, inspected).scan()
    const result = await new VolumeContentGarbageCollector(root, { pending: inspected.pending, allocation: () => ({ allocatedBytes: Number.MAX_SAFE_INTEGER + 1, evidence: 'verified-test' }) }).scan()
    expect(result).toMatchObject({ status: 'degraded', cleanableBytes: null, deletedBytes: 0, deleted: [] })
    await expect(readFile(object.path, 'utf8')).resolves.toBe('unsafe-delete')
  })
})
