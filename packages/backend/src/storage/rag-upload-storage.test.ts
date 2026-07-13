import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AssetManifestStore } from '@manta/storage-hub'
import { cleanupRagOrphans, createRagUploadStorage } from './rag-upload-storage'

describe('RAG original document storage', () => {
  it('publishes one CAS object and separate manifests for equal uploads with different document IDs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-cas-')); const volumeRoot = join(root, '.manta-ai'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    const first = await storage.ingest(Readable.from('same'), 'a.txt', async () => 'a', { volumeRoot, documentId: 'doc-a' })
    const second = await storage.ingest(Readable.from('same'), 'b.txt', async () => 'b', { volumeRoot, documentId: 'doc-b' })
    expect(first.sha256).toBe(second.sha256)
    const manifests = new AssetManifestStore(volumeRoot)
    await expect(manifests.read('document.doc-a')).resolves.toMatchObject({ assetId: 'document.doc-a' })
    await expect(manifests.read('document.doc-b')).resolves.toMatchObject({ assetId: 'document.doc-b' })
    expect(readdirSync(join(volumeRoot, '.ash', 'objects', 'sha256', first.sha256.slice(0, 2)))).toEqual([first.sha256])
  })

  it('does not publish a document manifest when processing fails and retains recoverable content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-cas-fail-')); const volumeRoot = join(root, '.manta-ai'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('recover me'), 'a.txt', async () => { throw new Error('pipeline failed') }, { volumeRoot, documentId: 'doc-failed' })).rejects.toThrow(/pipeline failed/)
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-failed')).rejects.toThrow()
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
  })

  it('does not start processing when document manifest publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-manifest-fail-')); const volumeRoot = join(root, '.manta-ai'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true }); let processed = false
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('recover me'), 'a.txt', async () => { processed = true }, { volumeRoot, documentId: 'doc-failed', beforePublish: () => { throw new Error('manifest fault') } })).rejects.toThrow(/manifest fault/)
    expect(processed).toBe(false)
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
  })

  it('does not delete an idempotent pre-existing manifest when a retry pipeline fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-existing-manifest-')); const volumeRoot = join(root, '.manta-ai'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true }); const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await storage.ingest(Readable.from('same'), 'a.txt', async () => 'ok', { volumeRoot, documentId: 'doc-stable' })
    await expect(storage.ingest(Readable.from('same'), 'a.txt', async () => { throw new Error('retry failed') }, { volumeRoot, documentId: 'doc-stable' })).rejects.toThrow(/retry failed/)
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-stable')).resolves.toMatchObject({ assetId: 'document.doc-stable' })
  })

  it('streams through cache/uploads, sanitizes names, and deduplicates identical content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-upload-'))
    const storage = createRagUploadStorage({
      cacheUploadsRoot: join(root, 'cache', 'uploads'),
      documentsRoot: join(root, 'knowledge', 'documents'),
    })
    const observed: string[] = []
    const first = await storage.ingest(Readable.from(['same ', 'document']), '../../unsafe.txt', async (staged) => {
      observed.push(staged)
      expect(existsSync(staged)).toBe(true)
      return readFileSync(staged)
    })
    const second = await storage.ingest(Readable.from(['same document']), 'copy.pdf', async () => undefined)

    expect(first.relativePath).toMatch(/^documents\/[a-f0-9]{64}$/)
    expect(second.relativePath).toBe(first.relativePath)
    expect(readFileSync(first.absolutePath, 'utf8')).toBe('same document')
    expect(readdirSync(join(root, 'knowledge', 'documents'))).toHaveLength(1)
    expect(readdirSync(join(root, 'cache', 'uploads'))).toEqual([])
    expect(observed).toHaveLength(1)
  })

  it('removes staged but retains the content-addressed orphan when processing fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-upload-fail-'))
    const storage = createRagUploadStorage({
      cacheUploadsRoot: join(root, 'cache', 'uploads'),
      documentsRoot: join(root, 'knowledge', 'documents'),
    })
    await expect(storage.ingest(Readable.from(['broken']), 'broken.txt', async () => {
      throw new Error('pipeline failed')
    })).rejects.toThrow(/pipeline failed/)
    expect(readdirSync(join(root, 'cache', 'uploads'))).toEqual([])
    expect(readdirSync(join(root, 'knowledge', 'documents'))).toHaveLength(1)
    expect(readdirSync(join(root, 'knowledge', '.orphans'))).toHaveLength(1)
  })

  it('does not invoke processing when durable copy fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-copy-fail-'))
    const blocked = join(root, 'blocked'); writeFileSync(blocked, 'file')
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: join(blocked, 'documents') })
    let processed = false
    await expect(storage.ingest(Readable.from('hello'), 'a.txt', async () => { processed = true })).rejects.toThrow()
    expect(processed).toBe(false)
  })

  it('rejects a corrupt pre-existing content-addressed blob and preserves its owner warning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-corrupt-')); const knowledge = join(root, 'knowledge'); const documents = join(knowledge, 'documents'); mkdirSync(documents, { recursive: true })
    const content = 'expected'; const hash = createHash('sha256').update(content).digest('hex'); writeFileSync(join(documents, hash), 'truncated')
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: documents }); let processed = false
    await expect(storage.ingest(Readable.from(content), 'a.txt', async () => { processed = true })).rejects.toThrow(/hash mismatch/)
    expect(processed).toBe(false); expect(readdirSync(join(knowledge, '.orphans', hash))).toHaveLength(1); expect(readFileSync(join(documents, hash), 'utf8')).toBe('truncated')
  })

  it('cleans only expired, unreferenced owned orphans', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-gc-')); const knowledge = join(root, 'knowledge')
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('orphan'), 'a.txt', async () => { throw new Error('fail') })).rejects.toThrow('fail')
    expect(await cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 1000), isReferenced: async () => true })).toEqual([])
    const removed = await cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 1000), isReferenced: async () => false })
    expect(removed).toHaveLength(1); expect(readdirSync(join(knowledge, '.orphans'))).toEqual([])
  })

  it('keeps the failed owner when identical concurrent uploads split success and failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-owner-set-')); const knowledge = join(root, 'knowledge'); const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: join(knowledge, 'documents') })
    const results = await Promise.allSettled([
      storage.ingest(Readable.from('same'), 'ok.txt', async () => 'ok'),
      storage.ingest(Readable.from('same'), 'fail.txt', async () => { throw new Error('pipeline failed') }),
    ])
    expect(results.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected'])
    const hash = readdirSync(join(knowledge, 'documents'))[0]; expect(readdirSync(join(knowledge, '.orphans', hash))).toHaveLength(1)
    expect(await cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 1000), isReferenced: async () => true })).toEqual([])
    expect(existsSync(join(knowledge, 'documents', hash))).toBe(true)
  })

  it('serializes GC with ingest and never deletes a newly-created hash owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-gc-race-')); const knowledge = join(root, 'knowledge'); const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('same'), 'old.txt', async () => { throw new Error('old fail') })).rejects.toThrow('old fail')
    const hash = readdirSync(join(knowledge, 'documents'))[0]; const ownerDir = join(knowledge, '.orphans', hash)
    const gc = cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 1000), isReferenced: async () => { writeFileSync(join(ownerDir, 'new-owner.json'), JSON.stringify({ version: 1, hash, transactionId: 'new-owner', createdAt: new Date().toISOString(), status: 'pending-pipeline' })); return false } })
    expect(await gc).toEqual([]); expect(existsSync(join(knowledge, 'documents', hash))).toBe(true); expect(readdirSync(ownerDir)).toEqual(['new-owner.json'])
  })
})
