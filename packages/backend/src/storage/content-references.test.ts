import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VolumeContentGarbageCollector, VolumeObjectStore } from '@manta/storage-hub'
import { beginRagAssetTransaction } from './rag-asset-transactions'
import { createVolumePendingInspector, inspectCrossGroupBlockers, inspectExtensionBlockers, inspectRagReferences } from './content-references'

const roots: string[] = []
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-pending-')); roots.push(value); return value }
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))) })

describe('pending content reference adapters', () => {
  it('keeps strict RAG journal hashes live and blocks deletion', async () => {
    const volumeRoot = await root(); const knowledgeRoot = join(volumeRoot, 'knowledge'); const id = '12345678-1234-4123-8123-123456789abc'; const hash = createHash('sha256').update('asset').digest('hex')
    await mkdir(join(knowledgeRoot, '.asset-transactions'), { recursive: true }); await mkdir(join(knowledgeRoot, 'documents'), { recursive: true })
    await writeFile(join(knowledgeRoot, '.asset-transactions', `${id}.json`), JSON.stringify({ schemaVersion: 1, transactionId: id, phase: 'prepared', assetId: 'document.doc', documentId: 'doc', safeName: 'doc', hash, size: 5, sourcePath: `knowledge/documents/${hash}`, createdAt: new Date().toISOString() }))
    const result = inspectRagReferences({ volumeRoot, knowledgeRoot })
    expect(result.liveHashes).toContain(hash); expect(result.blockers[0]?.code).toBe('rag-pending')
  })

  it('fails closed for malformed RAG and extension journals', async () => {
    const volumeRoot = await root(); const knowledgeRoot = join(volumeRoot, 'knowledge'); const extensionsRoot = join(volumeRoot, 'extensions')
    await mkdir(join(knowledgeRoot, '.asset-transactions'), { recursive: true }); await writeFile(join(knowledgeRoot, '.asset-transactions', 'bad.json'), '{')
    await mkdir(join(extensionsRoot, '.ash-transactions'), { recursive: true }); await writeFile(join(extensionsRoot, '.ash-transactions', 'bad.json'), '{')
    expect(inspectRagReferences({ volumeRoot, knowledgeRoot }).blockers[0]?.code).toBe('rag-journal-invalid')
    expect(inspectExtensionBlockers(extensionsRoot).blockers[0]?.code).toBe('extension-journal-invalid')
  })

  it('blocks a prepared cross-group journal', async () => {
    const groupRoot = await root(); await mkdir(join(groupRoot, '.ash-2pc'), { recursive: true })
    await writeFile(join(groupRoot, '.ash-2pc', 'bundle.json'), JSON.stringify({ version: 1, id: 'bundle', generation: 1, phase: 'prepared', txId: 'tx', changes: [] }))
    expect(inspectCrossGroupBlockers([groupRoot]).blockers[0]?.code).toBe('cross-group-pending')
  })

  it('preserves structured Git blocker codes and details', async () => {
    const volumeRoot = await root()
    const inspect = createVolumePendingInspector({ volumeRoot, knowledgeRoot: join(volumeRoot, 'knowledge'), extensionsRoot: join(volumeRoot, 'extensions'), groupRoots: [], migrationPending: () => false, gitPending: () => ({ liveHashes: [], blockers: [{ code: 'git-import-unreadable', path: 'cache/git-staging', detail: 'staging ACL denied' }] }) })
    expect((await inspect()).blockers).toContainEqual({ code: 'git-import-unreadable', path: 'cache/git-staging', detail: 'staging ACL denied' })
  })

  it('blocks unknown 2PC directory entries and incompletely shaped committed journals', async () => {
    const unknownRoot = await root(); await mkdir(join(unknownRoot, '.ash-2pc'), { recursive: true }); await writeFile(join(unknownRoot, '.ash-2pc', 'unexpected.tmp'), 'x')
    expect(inspectCrossGroupBlockers([unknownRoot]).blockers[0]?.code).toBe('cross-group-journal-invalid')
    const corruptRoot = await root(); await mkdir(join(corruptRoot, '.ash-2pc'), { recursive: true })
    await writeFile(join(corruptRoot, '.ash-2pc', 'bundle.json'), JSON.stringify({ version: 1, id: 'bundle', generation: 1, phase: 'committed' }))
    expect(inspectCrossGroupBlockers([corruptRoot]).blockers[0]?.code).toBe('cross-group-journal-invalid')
  })

  it('blocks a prepared 2PC journal with corrupted previous committed state', async () => {
    const groupRoot = await root(); await mkdir(join(groupRoot, '.ash-2pc'), { recursive: true })
    await writeFile(join(groupRoot, '.ash-2pc', 'bundle.json'), JSON.stringify({ version: 1, id: 'bundle', generation: 2, phase: 'prepared', txId: 'tx', changes: [], previous: {} }))
    expect(inspectCrossGroupBlockers([groupRoot]).blockers[0]?.code).toBe('cross-group-journal-invalid')
  })

  it('blocks prepared 2PC changes with fields outside their exact write or delete schema', async () => {
    for (const [id, change] of [
      ['delete-extra', { path: 'record.json', delete: true, unexpected: true }],
      ['write-extra', { path: 'record.json', content: '{}', hash: 'a'.repeat(64), unexpected: true }],
    ] as const) {
      const groupRoot = await root(); await mkdir(join(groupRoot, '.ash-2pc'), { recursive: true })
      await writeFile(join(groupRoot, '.ash-2pc', `${id}.json`), JSON.stringify({ version: 1, id, generation: 1, phase: 'prepared', txId: 'tx', changes: [change] }))
      expect(inspectCrossGroupBlockers([groupRoot]).blockers[0]?.code, id).toBe('cross-group-journal-invalid')
    }
  })

  it('blocks completed extension journals with missing or non-array registry state', async () => {
    for (const [name, registryWrites] of [['missing', undefined], ['wrong', {}]] as const) {
      const extensionsRoot = join(await root(), 'extensions'); await mkdir(join(extensionsRoot, '.ash-transactions'), { recursive: true })
      const journal = { version: 1, id: name, kind: 'file', phase: 'completed', destination: 'package/file', ...(registryWrites === undefined ? {} : { registryWrites }), registryDeletes: [] }
      await writeFile(join(extensionsRoot, '.ash-transactions', `${name}.json`), JSON.stringify(journal))
      expect(inspectExtensionBlockers(extensionsRoot).blockers[0]?.code).toBe('extension-journal-invalid')
    }
  })

  it('blocks extension journals with unknown fields or invalid discriminated field combinations', async () => {
    const fixtures = [
      { id: 'unknown', version: 1, kind: 'file', phase: 'completed', destination: 'package/file', content: '{}', registryWrites: [], registryDeletes: [], unexpected: true },
      { id: 'numeric-content', version: 1, kind: 'file', phase: 'completed', destination: 'package/file', content: 42, registryWrites: [], registryDeletes: [] },
      { id: 'install-content', version: 1, kind: 'install', phase: 'completed', destination: 'package/install', stagingPath: '.ash-staging/install', content: '{}', registryWrites: [], registryDeletes: [] },
      { id: 'install-no-stage', version: 1, kind: 'install', phase: 'completed', destination: 'package/install', registryWrites: [], registryDeletes: [] },
    ]
    for (const fixture of fixtures) {
      const extensionsRoot = join(await root(), 'extensions'); await mkdir(join(extensionsRoot, '.ash-transactions'), { recursive: true })
      await writeFile(join(extensionsRoot, '.ash-transactions', `${fixture.id}.json`), JSON.stringify(fixture))
      expect(inspectExtensionBlockers(extensionsRoot).blockers[0]?.code, fixture.id).toBe('extension-journal-invalid')
    }
  })

  it('serializes prepared RAG journal creation with GC and preserves its referenced CAS object', async () => {
    const volumeRoot = await root(); const knowledgeRoot = join(volumeRoot, 'knowledge'); const extensionsRoot = join(volumeRoot, 'extensions')
    const bytes = Buffer.from('prepared'); const object = await new VolumeObjectStore(volumeRoot).ingestBytes(bytes)
    await mkdir(join(knowledgeRoot, 'documents'), { recursive: true }); await writeFile(join(knowledgeRoot, 'documents', object.hash), bytes)
    const pending = createVolumePendingInspector({ volumeRoot, knowledgeRoot, extensionsRoot, groupRoots: [], migrationPending: () => false, gitPending: () => false })
    const transaction = beginRagAssetTransaction({ volumeRoot, knowledgeRoot, transactionId: '12345678-1234-4123-8123-123456789abc', documentId: 'doc', safeName: 'doc', hash: object.hash, size: object.size, source: join(knowledgeRoot, 'documents', object.hash) })
    const collected = new VolumeContentGarbageCollector(volumeRoot, { pending }).scan()
    await expect(transaction).resolves.toMatchObject({ phase: 'prepared', hash: object.hash })
    await expect(collected).resolves.toMatchObject({ status: 'degraded', deletedBytes: 0 })
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(object.path, 'utf8'))).resolves.toBe('prepared')
  })

  it('does not create a prepared RAG journal behind a GC scan that deletes its CAS object', async () => {
    const volumeRoot = await root(); const knowledgeRoot = join(volumeRoot, 'knowledge'); const bytes = Buffer.from('orphan'); const object = await new VolumeObjectStore(volumeRoot).ingestBytes(bytes)
    await mkdir(join(knowledgeRoot, 'documents'), { recursive: true }); await writeFile(join(knowledgeRoot, 'documents', object.hash), bytes)
    const allocation = (candidate: { size: number }) => ({ allocatedBytes: candidate.size, evidence: 'verified-test' })
    const safe = { pending: async () => ({ complete: true as const }), allocation }; await new VolumeContentGarbageCollector(volumeRoot, safe).scan()
    let releaseInspection!: () => void; let inspectionStarted!: () => void
    const started = new Promise<void>((resolve) => { inspectionStarted = resolve }); const release = new Promise<void>((resolve) => { releaseInspection = resolve })
    const deleting = new VolumeContentGarbageCollector(volumeRoot, { allocation, pending: async () => { inspectionStarted(); await release; return { complete: true } } }).scan()
    await started
    const transaction = beginRagAssetTransaction({ volumeRoot, knowledgeRoot, transactionId: '12345678-1234-4123-8123-123456789abd', documentId: 'late', safeName: 'late', hash: object.hash, size: object.size, source: join(knowledgeRoot, 'documents', object.hash) })
    releaseInspection(); await expect(deleting).resolves.toMatchObject({ deletedBytes: object.size })
    await expect(transaction).rejects.toThrow(/CAS|object|ENOENT/i)
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(join(knowledgeRoot, '.asset-transactions', '12345678-1234-4123-8123-123456789abd.json')))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
