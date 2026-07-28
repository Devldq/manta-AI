import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AssetManifestStore } from '@manta/storage-hub'
import { cleanupRagOrphans, createRagUploadResources, createRagUploadStorage, recoverRagAssetTransactions } from './rag-upload-storage'
import { matchesReadyRagDocument } from './rag-asset-transactions'

describe('RAG original document storage', () => {
  it('does not read cloud orphan metadata while closing an idle runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-close-'))
    const knowledge = join(root, 'knowledge')
    const orphan = join(knowledge, '.orphans', 'a'.repeat(64))
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, 'invalid.json'), 'not json')
    const resources = createRagUploadResources(join(root, 'cache', 'uploads'), knowledge, async () => false)

    expect(resources.knowledge.integrityCheck().ok).toBe(false)
    expect(() => resources.knowledge.close()).not.toThrow()
  })

  it('reuses a completed equal-content document before invoking the pipeline or publishing another manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-reuse-ready-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    let processed = false
    const reused = await storage.ingest(
      Readable.from('already processed'),
      'duplicate.txt',
      async () => { processed = true; return 'processed-again' },
      { volumeRoot, documentId: 'doc-duplicate' },
      async (document) => ({ result: `ready:${document.sha256}` }),
    )

    expect(processed).toBe(false)
    expect(reused.reused).toBe(true)
    expect(reused.result).toBe(`ready:${reused.sha256}`)
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-duplicate')).rejects.toThrow()
    expect(existsSync(join(knowledge, '.asset-transactions'))).toBe(false)
  })

  it('requires exact ready document identity, hash, and asset reference for crash recovery', () => {
    const record = { documentId: 'doc-exact', assetId: 'document.doc-exact', hash: 'a'.repeat(64) }
    const ready = { id: 'doc-exact', status: 'ready', sourceSha256: 'a'.repeat(64), sourcePath: 'asset:document.doc-exact' }
    expect(matchesReadyRagDocument(record, ready)).toBe(true)
    expect(matchesReadyRagDocument(record, { ...ready, id: 'doc-other' })).toBe(false)
    expect(matchesReadyRagDocument(record, { ...ready, status: 'processing' })).toBe(false)
    expect(matchesReadyRagDocument(record, { ...ready, sourceSha256: 'b'.repeat(64) })).toBe(false)
    expect(matchesReadyRagDocument(record, { ...ready, sourcePath: 'asset:document.doc-other' })).toBe(false)
    expect(matchesReadyRagDocument(record, null)).toBe(false)
  })

  it('publishes one CAS object and separate manifests for equal uploads with different document IDs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-cas-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
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
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-cas-fail-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('recover me'), 'a.txt', async () => { throw new Error('pipeline failed') }, { volumeRoot, documentId: 'doc-failed' })).rejects.toThrow(/pipeline failed/)
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-failed')).rejects.toThrow()
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toEqual([])
  })

  it('does not expose an asset manifest while the RAG pipeline is still running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-private-stage-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await storage.ingest(Readable.from('private until committed'), 'a.txt', async () => {
      await expect(new AssetManifestStore(volumeRoot).read('document.doc-private')).rejects.toThrow()
      return 'ok'
    }, { volumeRoot, documentId: 'doc-private' })
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-private')).resolves.toBeDefined()
  })

  it('never publishes a prepared-only transaction during restart recovery and keeps its ordinary source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-prepared-recovery-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('recoverable ordinary source'), 'a.txt', async () => 'not-called', {
      volumeRoot, documentId: 'doc-prepared', fault: (phase) => { if (phase === 'after-prepared') throw new Error('simulated crash') },
    })).rejects.toThrow(/simulated crash/)
    const transactionRoot = join(knowledge, '.asset-transactions')
    const journalName = readdirSync(transactionRoot)[0]!
    const journal = JSON.parse(readFileSync(join(transactionRoot, journalName), 'utf8')) as { phase: string; sourcePath: string }
    expect(journal).toMatchObject({ phase: 'prepared' })
    expect(journal.sourcePath).not.toMatch(/^(?:[\\/]|[a-zA-Z]:)/)
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-prepared')).rejects.toThrow()
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
    expect(existsSync(join(transactionRoot, journalName))).toBe(true)
  })

  it('does not garbage-collect the recoverable ordinary source owned by a prepared asset transaction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-prepared-gc-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('retain through gc'), 'a.txt', async () => undefined, {
      volumeRoot, documentId: 'doc-retained', fault: (phase) => { if (phase === 'after-prepared') throw new Error('crash') },
    })).rejects.toThrow('crash')
    expect(await cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 60_000), isReferenced: async () => false })).toEqual([])
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
  })

  it('does not let a successful equal-byte asset cleanup delete another prepared transaction source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-shared-prepared-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('shared recovery bytes'), 'failed.txt', async () => undefined, {
      volumeRoot, documentId: 'doc-prepared-owner', fault: (phase) => { if (phase === 'after-prepared') throw new Error('crash') },
    })).rejects.toThrow('crash')
    await storage.ingest(Readable.from('shared recovery bytes'), 'ready.txt', async () => 'ready', { volumeRoot, documentId: 'doc-ready-owner' })
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-prepared-owner')).rejects.toThrow()
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
  })

  it('durably advances and publishes a prepared transaction only when the exact pipeline record is authoritative', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-authoritative-recovery-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('database committed before crash'), 'a.txt', async () => undefined, {
      volumeRoot, documentId: 'doc-authoritative', fault: (phase) => { if (phase === 'after-prepared') throw new Error('crash') },
    })).rejects.toThrow('crash')
    let observed: { documentId: string; assetId: string; hash: string } | undefined
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge }, { isPipelineCommitted: async (record) => { observed = record; return record.documentId === 'doc-authoritative' && record.assetId === 'document.doc-authoritative' } })
    expect(observed).toMatchObject({ documentId: 'doc-authoritative', assetId: 'document.doc-authoritative' })
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-authoritative')).resolves.toMatchObject({ entries: [expect.objectContaining({ hash: observed!.hash })] })
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toEqual([])
  })

  it('publishes only a durably pipeline-committed transaction during restart recovery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-committed-recovery-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    let processed = false
    await expect(storage.ingest(Readable.from('publish after restart'), 'a.txt', async () => { processed = true; return 'done' }, {
      volumeRoot, documentId: 'doc-committed', fault: (phase) => { if (phase === 'after-pipeline-committed') throw new Error('simulated crash') },
    })).rejects.toThrow(/simulated crash/)
    expect(processed).toBe(true)
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-committed')).rejects.toThrow()
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-committed')).resolves.toMatchObject({ assetId: 'document.doc-committed' })
    expect(readdirSync(join(knowledge, 'documents'))).toEqual([])
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toEqual([])
  })

  it('returns pipeline success when post-publication cleanup fails and recovery retries it idempotently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-cleanup-recovery-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    const completed = await storage.ingest(Readable.from('business success'), 'a.txt', async () => 'accepted', {
      volumeRoot, documentId: 'doc-cleanup', fault: (phase) => { if (phase === 'before-cleanup') throw new Error('cleanup unavailable') },
    })
    expect(completed.result).toBe('accepted')
    await expect(new AssetManifestStore(volumeRoot).read('document.doc-cleanup')).resolves.toBeDefined()
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toHaveLength(1)
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })
    await recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })
    expect(readdirSync(join(knowledge, 'documents'))).toEqual([])
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toEqual([])
  })

  it('rejects tampered root-relative journals and linked transaction ancestors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-journal-safe-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge'); mkdirSync(knowledge, { recursive: true })
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('tamper target'), 'a.txt', async () => undefined, {
      volumeRoot, documentId: 'doc-tampered', fault: (phase) => { if (phase === 'after-prepared') throw new Error('crash') },
    })).rejects.toThrow('crash')
    const transactionRoot = join(knowledge, '.asset-transactions'); const journalPath = join(transactionRoot, readdirSync(transactionRoot)[0]!)
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')); journal.sourcePath = '../outside'; writeFileSync(journalPath, JSON.stringify(journal))
    await expect(recoverRagAssetTransactions({ volumeRoot, knowledgeRoot: knowledge })).rejects.toThrow(/journal|relative|outside|path/i)

    const outside = mkdtempSync(join(tmpdir(), 'manta-rag-journal-outside-')); const held = `${transactionRoot}.held`; renameSync(transactionRoot, held)
    symlinkSync(outside, transactionRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(storage.ingest(Readable.from('must stay inside'), 'b.txt', async () => undefined, { volumeRoot, documentId: 'doc-linked' })).rejects.toThrow(/link|reparse|ancestor/i)
    expect(readdirSync(outside)).toEqual([])
  })

  it('does not publish a manifest when post-pipeline publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-manifest-fail-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
    mkdirSync(knowledge, { recursive: true }); let processed = false
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('recover me'), 'a.txt', async () => { processed = true }, { volumeRoot, documentId: 'doc-failed', beforePublish: () => { throw new Error('manifest fault') } })).rejects.toThrow(/manifest fault/)
    expect(processed).toBe(true)
    expect(readdirSync(join(knowledge, 'documents'))).toHaveLength(1)
  })

  it('does not delete an idempotent pre-existing manifest when a retry pipeline fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-existing-manifest-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
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

  it('re-reads prepared owners inside the hash lock immediately before orphan deletion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-owner-interleave-')); const knowledge = join(root, 'knowledge')
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(root, 'cache'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('interleaved owner'), 'a.txt', async () => { throw new Error('pipeline failed') })).rejects.toThrow('pipeline failed')
    const hash = readdirSync(join(knowledge, 'documents'))[0]!; const transactionId = randomUUID(); const transactionRoot = join(knowledge, '.asset-transactions')
    const removed = await cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 60_000), isReferenced: async () => {
      mkdirSync(transactionRoot, { recursive: true })
      writeFileSync(join(transactionRoot, `${transactionId}.json`), JSON.stringify({
        schemaVersion: 1, transactionId, phase: 'prepared', assetId: 'document.doc-interleaved', documentId: 'doc-interleaved', safeName: 'a.txt', hash,
        size: Buffer.byteLength('interleaved owner'), sourcePath: `knowledge/documents/${hash}`, createdAt: new Date().toISOString(),
      }))
      return false
    } })
    expect(removed).toEqual([])
    expect(readFileSync(join(knowledge, 'documents', hash), 'utf8')).toBe('interleaved owner')
  })

  it('serializes an async GC decision with a new prepared owner without deadlocking or losing its source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-async-lock-')); const volumeRoot = join(root, 'manta-ai-data'); const knowledge = join(volumeRoot, 'knowledge')
    const storage = createRagUploadStorage({ cacheUploadsRoot: join(volumeRoot, 'cache', 'uploads'), documentsRoot: join(knowledge, 'documents') })
    await expect(storage.ingest(Readable.from('async lock bytes'), 'old.txt', async () => { throw new Error('old failure') })).rejects.toThrow('old failure')
    const hash = readdirSync(join(knowledge, 'documents'))[0]!
    let enterGc!: () => void; const gcEntered = new Promise<void>((resolve) => { enterGc = resolve })
    let releaseGc!: () => void; const gcGate = new Promise<void>((resolve) => { releaseGc = resolve })
    const gc = cleanupRagOrphans(knowledge, { olderThan: new Date(Date.now() + 60_000), isReferenced: async () => { enterGc(); await gcGate; return false } })
    await gcEntered
    let ownerSettled = false
    const owner = storage.ingest(Readable.from('async lock bytes'), 'owner.txt', async () => undefined, {
      volumeRoot, documentId: 'doc-async-owner', fault: (phase) => { if (phase === 'after-prepared') throw new Error('owner crash') },
    }).finally(() => { ownerSettled = true })
    await Promise.resolve(); expect(ownerSettled).toBe(false)
    releaseGc(); await expect(gc).resolves.toEqual([hash]); await expect(owner).rejects.toThrow('owner crash')
    expect(readFileSync(join(knowledge, 'documents', hash), 'utf8')).toBe('async lock bytes')
    expect(readdirSync(join(knowledge, '.asset-transactions'))).toHaveLength(1)
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
