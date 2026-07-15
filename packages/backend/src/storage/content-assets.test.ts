import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AssetManifestStore } from '@manta/storage-hub'
import { createContentAssetService } from './content-assets'

describe('backend content asset snapshots', () => {
  it('publishes distinct document manifests while identical bytes share one volume object', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-content-assets-'))
    const first = join(volumeRoot, 'cache', 'first.upload')
    const second = join(volumeRoot, 'cache', 'second.upload')
    mkdirSync(join(volumeRoot, 'cache')); writeFileSync(first, 'same document'); writeFileSync(second, 'same document')
    const assets = createContentAssetService({ volumeRoot, trustedStagingRoot: join(volumeRoot, 'cache') })

    const a = await assets.snapshotDocument({ documentId: 'doc-a', source: first, name: 'first.txt' })
    const b = await assets.snapshotDocument({ documentId: 'doc-b', source: second, name: 'second.txt' })

    expect(a.manifest.assetId).toBe('document.doc-a')
    expect(b.manifest.assetId).toBe('document.doc-b')
    expect(a.object.hash).toBe(b.object.hash)
    expect(readdirSync(join(volumeRoot, '.ash', 'objects', 'sha256', a.object.hash.slice(0, 2)))).toEqual([a.object.hash])
  })

  it('resolves concurrent identical publication and rejects a conflicting immutable winner exactly', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-content-race-')); const cache = join(volumeRoot, 'cache'); mkdirSync(cache)
    const sameA = join(cache, 'same-a'); const sameB = join(cache, 'same-b'); writeFileSync(sameA, 'same'); writeFileSync(sameB, 'same')
    let arrivals = 0; let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    const assets = createContentAssetService({ volumeRoot, trustedStagingRoot: cache, beforePublish: async () => { if (++arrivals === 2) release(); await gate } })
    const identical = await Promise.all([
      assets.snapshotDocument({ documentId: 'doc-race-same', source: sameA, name: 'same.txt' }),
      assets.snapshotDocument({ documentId: 'doc-race-same', source: sameB, name: 'same.txt' }),
    ])
    expect(identical[0].manifest).toEqual(identical[1].manifest)

    const first = join(cache, 'first'); const second = join(cache, 'second'); writeFileSync(first, 'first'); writeFileSync(second, 'second')
    arrivals = 0; let releaseConflict!: () => void; const conflictGate = new Promise<void>((resolve) => { releaseConflict = resolve })
    const conflicting = createContentAssetService({ volumeRoot, trustedStagingRoot: cache, beforePublish: async () => { if (++arrivals === 2) releaseConflict(); await conflictGate } })
    const results = await Promise.allSettled([
      conflicting.snapshotDocument({ documentId: 'doc-race-conflict', source: first, name: 'same.txt' }),
      conflicting.snapshotDocument({ documentId: 'doc-race-conflict', source: second, name: 'same.txt' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('snapshots immutable package trees with their logical ID and rejects internal or linked content', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-package-assets-'))
    const packageRoot = join(volumeRoot, 'incoming', 'demo'); mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'SKILL.md'), 'same'); writeFileSync(join(packageRoot, 'notes.md'), 'same')
    const assets = createContentAssetService({ volumeRoot })
    const snapshot = await assets.snapshotPackage({ kind: 'skill', logicalId: 'skill-existing', version: '1.0.0', sourceRoot: packageRoot })
    expect(snapshot.manifest.assetId).toMatch(/^skill\.skill-existing\./)
    expect(snapshot.manifest.entries).toHaveLength(2)
    expect(new Set(snapshot.manifest.entries.map((entry) => entry.hash))).toHaveLength(1)

    mkdirSync(join(packageRoot, '.git')); writeFileSync(join(packageRoot, '.git', 'config'), 'bad')
    await expect(assets.snapshotPackage({ kind: 'skill', logicalId: 'skill-existing', version: '1.0.1', sourceRoot: packageRoot })).rejects.toThrow(/\.git|internal/i)
    mkdirSync(join(volumeRoot, 'outside')); symlinkSync(join(volumeRoot, 'outside'), join(packageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(assets.snapshotPackage({ kind: 'skill', logicalId: 'skill-existing', version: '1.0.2', sourceRoot: packageRoot })).rejects.toThrow(/link|reparse|\.git/i)
  })

  it('retains recoverable source and immutable successful manifests when a legacy conversion fails', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-legacy-assets-'))
    const legacy = join(volumeRoot, 'knowledge', 'documents', 'shared')
    mkdirSync(join(volumeRoot, 'knowledge', 'documents'), { recursive: true }); writeFileSync(legacy, 'legacy bytes')
    let publications = 0
    const failing = createContentAssetService({ volumeRoot, beforePublish: () => { if (++publications === 2) throw new Error('manifest fault') } })
    const documents = [
      { documentId: 'doc-old-a', source: legacy, name: 'a.txt' },
      { documentId: 'doc-old-b', source: legacy, name: 'b.txt' },
    ]

    await expect(failing.migrateLegacyDocuments(documents)).rejects.toThrow(/manifest fault/)
    expect(existsSync(legacy)).toBe(true)
    const manifests = new AssetManifestStore(volumeRoot)
    await expect(manifests.read('document.doc-old-a')).resolves.toMatchObject({ assetId: 'document.doc-old-a' })
    await expect(manifests.read('document.doc-old-b')).rejects.toThrow()

    const migrated = await createContentAssetService({ volumeRoot }).migrateLegacyDocuments(documents)
    expect(existsSync(legacy)).toBe(false)
    expect(migrated.retiredSources).toHaveLength(1)
    expect(readFileSync(migrated.retiredSources[0], 'utf8')).toBe('legacy bytes')
    await expect(manifests.read('document.doc-old-a')).resolves.toMatchObject({ assetId: 'document.doc-old-a' })
    await expect(manifests.read('document.doc-old-b')).resolves.toMatchObject({ assetId: 'document.doc-old-b' })
  })

  it('does not delete an immutable manifest reused by another transaction when its creator later fails', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-shared-manifest-owner-')); const legacy = join(volumeRoot, 'knowledge', 'documents', 'shared')
    mkdirSync(join(volumeRoot, 'knowledge', 'documents'), { recursive: true }); writeFileSync(legacy, 'shared immutable bytes')
    const reuser = createContentAssetService({ volumeRoot }); let publications = 0
    const creator = createContentAssetService({ volumeRoot, beforePublish: async () => {
      if (++publications !== 2) return
      await reuser.snapshotDocument({ documentId: 'doc-shared-a', source: legacy, name: 'a.txt' })
      throw new Error('creator transaction failed')
    } })
    await expect(creator.migrateLegacyDocuments([
      { documentId: 'doc-shared-a', source: legacy, name: 'a.txt' },
      { documentId: 'doc-shared-b', source: legacy, name: 'b.txt' },
    ])).rejects.toThrow('creator transaction failed')
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-shared-a')).resolves.toMatchObject({ assetId: 'document.doc-shared-a' })
    expect(readFileSync(legacy, 'utf8')).toBe('shared immutable bytes')
  })

  it('refuses to retire legacy content through a linked backup ancestor', async () => {
    const volumeRoot = mkdtempSync(join(tmpdir(), 'manta-linked-backup-')); const outside = mkdtempSync(join(tmpdir(), 'manta-linked-outside-'))
    const legacy = join(volumeRoot, 'knowledge', 'documents', 'old'); mkdirSync(join(volumeRoot, 'knowledge', 'documents'), { recursive: true }); writeFileSync(legacy, 'keep')
    symlinkSync(outside, join(volumeRoot, '.ash-backups'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(createContentAssetService({ volumeRoot }).migrateLegacyDocuments([{ documentId: 'doc-safe', source: legacy, name: 'old.txt' }])).rejects.toThrow(/symlink|reparse|ancestor/i)
    expect(readFileSync(legacy, 'utf8')).toBe('keep')
    expect(readdirSync(outside)).toEqual([])
  })
})
