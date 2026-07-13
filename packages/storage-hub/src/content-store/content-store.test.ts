import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
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

  it('materializes by reflink when available and falls back to a verified copy', async () => {
    const volume = await root(); const source = join(volume, 'source.bin'); await writeFile(source, 'immutable bytes')
    const object = await new VolumeObjectStore(volume).ingestFile(source)
    const linked = join(volume, 'assets', 'linked.bin')
    const result = await materializeAsset({ volumeRoot: volume, object, destination: linked })
    expect(['reflink', 'copy']).toContain(result.strategy); expect(await readFile(linked, 'utf8')).toBe('immutable bytes')
    const copied = join(volume, 'assets', 'copied.bin')
    const copy = await materializeAsset({ volumeRoot: volume, object, destination: copied, reflink: async () => { throw Object.assign(new Error('reflink unavailable'), { code: 'ENOTSUP' }) } })
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

  it('ingests only a regular file below an explicitly trusted volume cache staging root', async () => {
    const volume = await root(); const staging = join(volume, 'cache', 'uploads'); await mkdir(staging, { recursive: true }); const input = join(staging, 'one.upload'); await writeFile(input, 'staged')
    const objects = new VolumeObjectStore(volume)
    await expect(objects.ingestStagedFile(input, staging)).resolves.toMatchObject({ hash: sha256('staged') })
    const outside = join(volume, 'knowledge', 'document'); await mkdir(join(volume, 'knowledge')); await writeFile(outside, 'outside')
    await expect(objects.ingestStagedFile(outside, staging)).rejects.toThrow(/staging|cache|outside/i)
  })

  it('rejects a staged file below a linked nested cache ancestor', async () => {
    const volume = await root(); const outside = await root(); const staging = join(volume, 'cache', 'uploads'); await mkdir(staging, { recursive: true })
    await symlink(outside, join(staging, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); const input = join(outside, 'document.upload'); await writeFile(input, 'outside')
    await expect(new VolumeObjectStore(volume).ingestStagedFile(join(staging, 'linked', 'document.upload'), staging)).rejects.toThrow(/symlink|junction|reparse|ancestor/i)
  })

  it('rejects a Windows destination on another drive before it can be materialized', async () => {
    const volume = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('asset'))
    await expect(materializeAsset({ volumeRoot: volume, object, destination: 'D:\\outside-volume\\asset.bin' })).rejects.toThrow(/escapes/i)
  })

  it('rejects a destination below a symlinked ancestor', async () => {
    const volume = await root(); const outside = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('asset'))
    const assets = join(volume, 'assets'); await symlink(outside, assets, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(materializeAsset({ volumeRoot: volume, object, destination: join(assets, 'asset.bin') })).rejects.toThrow(/symlink|reparse|escape/i)
  })

  it('does not let writes to a materialized asset mutate its CAS object', async () => {
    const volume = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('immutable'))
    const destination = join(volume, 'assets', 'asset.bin'); await materializeAsset({ volumeRoot: volume, object, destination })
    await writeFile(destination, 'changed')
    expect(await readFile(object.path, 'utf8')).toBe('immutable')
  })

  it('rejects malformed and identity-mismatched manifests when reading', async () => {
    const volume = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('asset')); const manifests = new AssetManifestStore(volume)
    const path = manifests.pathFor('expected')
    await mkdir(join(volume, '.ash', 'assets'), { recursive: true })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, assetId: 'other', createdAt: 'not-a-date', entries: [{ path: 'one.bin', hash: object.hash, size: object.size }, { path: 'one.bin', hash: object.hash, size: object.size }] }))
    await expect(manifests.read('expected')).rejects.toThrow(/schema|identifier|asset|created|unique/i)
  })

  it('propagates reflink permission errors instead of falling back to copy', async () => {
    const volume = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('asset'))
    await expect(materializeAsset({ volumeRoot: volume, object, destination: join(volume, 'assets', 'asset.bin'), reflink: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) } })).rejects.toThrow(/denied/i)
  })

  it('creates an immutable manifest once when concurrent publishers disagree', async () => {
    const volume = await root(); const objects = new VolumeObjectStore(volume); const first = await objects.ingestBytes(Buffer.from('one')); const second = await objects.ingestBytes(Buffer.from('two')); const manifests = new AssetManifestStore(volume)
    const results = await Promise.allSettled([manifests.write({ assetId: 'race', entries: [{ path: 'one.bin', hash: first.hash, size: first.size }] }), manifests.write({ assetId: 'race', entries: [{ path: 'two.bin', hash: second.hash, size: second.size }] })])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('removes only the exact manifest revision approved by its caller', async () => {
    const volume = await root(); const object = await new VolumeObjectStore(volume).ingestBytes(Buffer.from('asset')); const manifests = new AssetManifestStore(volume)
    const first = await manifests.write({ assetId: 'removable', entries: [{ path: 'one.bin', hash: object.hash, size: object.size }] })
    await expect(manifests.remove('removable', { createdAt: '2000-01-01T00:00:00.000Z' })).resolves.toBe(false)
    await expect(manifests.read('removable')).resolves.toMatchObject({ createdAt: first.createdAt })
    await expect(manifests.remove('removable', { createdAt: first.createdAt! })).resolves.toBe(true)
    await expect(manifests.read('removable')).rejects.toThrow()
  })
})
