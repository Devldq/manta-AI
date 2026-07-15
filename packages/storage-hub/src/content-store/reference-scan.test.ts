import { mkdtemp, mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetManifestStore } from './manifest-store'
import { VolumeObjectStore } from './object-store'
import { scanVolumeReferences, scanVolumeReferencesReadOnly } from './reference-scan'
import { sumLogicalReferenceBytes } from './reference-scan'

const roots: string[] = []
async function volume(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ash-reference-scan-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('volume reference scan', () => {
  it('fails closed when repeated reference sizes overflow the safe integer range', () => {
    expect(sumLogicalReferenceBytes([Number.MAX_SAFE_INTEGER, 1])).toEqual({ bytes: null, overflow: true })
  })
  it('counts every manifest entry while verifying one volume-local physical object', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('same'))
    await new AssetManifestStore(root).write({ assetId: 'one', entries: [{ path: 'a', hash: object.hash, size: object.size }, { path: 'b', hash: object.hash, size: object.size }] })
    const scan = await scanVolumeReferences(root)
    expect(scan.complete).toBe(true)
    expect(scan.logicalImmutableBytes).toBe(object.size * 2)
    expect(scan.objects).toEqual([expect.objectContaining({ hash: object.hash, size: object.size })])
  })

  it('fails closed for malformed manifests and object integrity failures', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('asset'))
    await mkdir(join(root, '.ash', 'assets'), { recursive: true })
    await writeFile(join(root, '.ash', 'assets', 'bad.json'), '{')
    await writeFile(object.path, 'changed')
    const scan = await scanVolumeReferences(root)
    expect(scan.complete).toBe(false)
    expect(scan.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(['manifest-invalid', 'object-integrity']))
  })

  it('keeps identical hashes in separate volume scans as separate physical copies', async () => {
    const first = await volume(); const second = await volume()
    await new VolumeObjectStore(first).ingestBytes(Buffer.from('same'))
    await new VolumeObjectStore(second).ingestBytes(Buffer.from('same'))
    const [a, b] = await Promise.all([scanVolumeReferences(first), scanVolumeReferences(second)])
    expect(a.volumeRoot).toBe(first); expect(b.volumeRoot).toBe(second)
    expect(a.objects).toHaveLength(1); expect(b.objects).toHaveLength(1)
  })

  it('fails closed when the canonical object path is replaced after handle hashing with an identical inode', async () => {
    const root = await volume(); const object = await new VolumeObjectStore(root).ingestBytes(Buffer.from('same inode-sized bytes'))
    const original = await stat(object.path); const replacement = join(root, 'replacement'); const displaced = join(root, 'displaced')
    await writeFile(replacement, Buffer.from('same inode-sized bytes'))
    await utimes(replacement, original.atime, original.mtime)
    let replaced = false
    const scan = await scanVolumeReferencesReadOnly(root, undefined, { afterHandleHashBeforeCanonicalPathValidation: async (path) => {
      if (replaced) return
      replaced = true
      await rename(path, displaced)
      await rename(replacement, path)
    } })
    expect(scan.complete).toBe(false)
    expect(scan.objects).toEqual([])
    expect(scan.blockers).toContainEqual(expect.objectContaining({ code: 'object-integrity', detail: expect.stringMatching(/identity|changed|stable/i) }))
  })
})
