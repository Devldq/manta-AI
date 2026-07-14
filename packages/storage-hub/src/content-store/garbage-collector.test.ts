import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('quarantines on the first clean scan and deletes the same unchanged object on a later clean scan', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root)
    const first = await gc.scan(); expect(first.deletedBytes).toBe(0); expect(first.cleanableBytes).toBe(object.size)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('orphan')
    const second = await gc.scan(); expect(second.deletedBytes).toBe(object.size)
    await expect(readFile(object.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never quarantines a manifest or pending referenced object', async () => {
    const root = await volume(); const objects = new VolumeObjectStore(root); const manifestObject = await objects.ingestBytes(Buffer.from('manifest')); const pendingObject = await objects.ingestBytes(Buffer.from('pending'))
    await new AssetManifestStore(root).write({ assetId: 'asset', entries: [{ path: 'asset', hash: manifestObject.hash, size: manifestObject.size }] })
    const result = await new VolumeContentGarbageCollector(root, { pending: async () => ({ liveHashes: [pendingObject.hash] }) }).scan()
    expect(result.cleanableBytes).toBe(0); expect(result.deletedBytes).toBe(0)
  })

  it('does not advance or delete candidates during a degraded scan', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root)
    await gc.scan(); await mkdir(join(root, '.ash', 'assets'), { recursive: true }); await writeFile(join(root, '.ash', 'assets', 'broken.json'), '{')
    const degraded = await gc.scan(); expect(degraded.status).toBe('degraded'); expect(degraded.deletedBytes).toBe(0)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('orphan')
  })

  it('fails closed for malformed quarantine state', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('orphan')); const gc = new VolumeContentGarbageCollector(root)
    await gc.scan(); await writeFile(join(root, '.ash', 'gc', 'quarantine', `${object.hash}.json`), '{')
    const result = await gc.scan(); expect(result.status).toBe('degraded'); expect(result.deletedBytes).toBe(0)
  })

  it('shares the volume lease with a concurrent manifest publisher', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('publish')); const manifests = new AssetManifestStore(root); const gc = new VolumeContentGarbageCollector(root)
    await gc.scan()
    const [published, collected] = await Promise.all([manifests.write({ assetId: 'asset', entries: [{ path: 'asset', hash: object.hash, size: object.size }] }), gc.scan()])
    expect(published.assetId).toBe('asset'); expect(collected.deletedBytes).toBe(0)
    await expect(readFile(object.path, 'utf8')).resolves.toBe('publish')
  })
})
