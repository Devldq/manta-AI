import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectCrossGroupBlockers, inspectExtensionBlockers, inspectRagReferences } from './content-references'

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
})
