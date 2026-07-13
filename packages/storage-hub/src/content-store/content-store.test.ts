import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetManifestStore, VolumeObjectStore, materializeAsset } from './index'

const roots: string[] = []
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-cas-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => import('node:fs/promises').then(({ rm }) => rm(value, { recursive: true, force: true })))) })

describe('per-volume content addressed storage', () => {
  it('keeps one SHA-256 object when duplicate bytes ingest concurrently', async () => {
    const volume = await root(); const input = join(volume, 'source.txt'); await writeFile(input, 'same bytes')
    const store = new VolumeObjectStore(volume)
    const [first, second] = await Promise.all([store.ingestFile(input), store.ingestFile(input)])
    expect(first).toEqual(second); expect(first.hash).toBe(sha256('same bytes'))
    expect(await readFile(first.path, 'utf8')).toBe('same bytes')
    expect((await stat(first.path)).size).toBe(10)
  })

  it('rejects unsafe object hashes, asset identifiers, and manifest paths', async () => {
    const volume = await root(); const objects = new VolumeObjectStore(volume); const manifests = new AssetManifestStore(volume)
    await expect(objects.pathFor('../escape')).rejects.toThrow(/hash/i)
    await expect(manifests.write({ assetId: '../asset', entries: [] })).rejects.toThrow(/asset/i)
    await expect(manifests.write({ assetId: 'valid-asset', entries: [{ path: '../escape', hash: sha256('x'), size: 1 }] })).rejects.toThrow(/path/i)
  })

  it('persists manifests independently and only for verified objects in this volume', async () => {
    const volume = await root(); const objects = new VolumeObjectStore(volume); const object = await objects.ingestBytes(Buffer.from('asset'))
    const manifests = new AssetManifestStore(volume)
    await manifests.write({ assetId: 'manual-v1', entries: [{ path: 'manual.pdf', hash: object.hash, size: object.size }] })
    await expect(manifests.read('manual-v1')).resolves.toMatchObject({ assetId: 'manual-v1', entries: [{ hash: object.hash }] })
    await expect(manifests.write({ assetId: 'foreign', entries: [{ path: 'foreign.bin', hash: sha256('other volume'), size: 12 }] })).rejects.toThrow(/ENOENT|object/i)
  })

  it('materializes by hardlink when available and falls back to a verified copy', async () => {
    const volume = await root(); const source = join(volume, 'source.bin'); await writeFile(source, 'immutable bytes')
    const object = await new VolumeObjectStore(volume).ingestFile(source)
    const linked = join(volume, 'assets', 'linked.bin')
    const result = await materializeAsset({ volumeRoot: volume, object, destination: linked })
    expect(['hardlink', 'reflink', 'copy']).toContain(result.strategy); expect(await readFile(linked, 'utf8')).toBe('immutable bytes')
    const copied = join(volume, 'assets', 'copied.bin')
    const copy = await materializeAsset({ volumeRoot: volume, object, destination: copied, link: async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }) }, reflink: async () => { throw new Error('reflink unavailable') } })
    expect(copy.strategy).toBe('copy'); expect(await readFile(copied, 'utf8')).toBe('immutable bytes')
  })

  it('requires explicit verified replacement for an existing immutable destination', async () => {
    const volume = await root(); const source = join(volume, 'source.txt'); await writeFile(source, 'new')
    const object = await new VolumeObjectStore(volume).ingestFile(source); const destination = join(volume, 'assets', 'asset.txt'); await mkdir(join(volume, 'assets')); await writeFile(destination, 'old')
    await expect(materializeAsset({ volumeRoot: volume, object, destination })).rejects.toThrow(/exists/i)
    await expect(materializeAsset({ volumeRoot: volume, object, destination, replace: { approved: true, expectedHash: sha256('old') } })).resolves.toMatchObject({ hash: object.hash })
    expect(await readFile(destination, 'utf8')).toBe('new')
  })

  it('does not permit CAS objects or manifests to overlap mutable storage groups', async () => {
    const volume = await root(); const input = join(volume, 'config', 'settings.json'); await mkdir(join(volume, 'config'), { recursive: true }); await writeFile(input, '{}')
    await expect(new VolumeObjectStore(volume).ingestFile(input)).rejects.toThrow(/mutable|group/i)
    await expect(new AssetManifestStore(volume).write({ assetId: 'asset', entries: [{ path: 'config/settings.json', hash: sha256('x'), size: 1 }] })).rejects.toThrow(/path|group/i)
  })
})
