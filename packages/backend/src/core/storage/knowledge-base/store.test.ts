import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withVolumeContentStoreLease } from '@manta/storage-hub'
import { runWithStorageResolver } from '../../../storage/path-routing'
import { retryContentStoreLease } from '../../../storage/content-store-lease-retry'
import {
  createKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  recordKnowledgeBaseDocumentAdded,
  recordKnowledgeBaseDocumentRemoved,
} from './store'

function fixture<T>(operation: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'manta-rag-directory-'))
  return runWithStorageResolver(
    { resolve: (group, ...segments) => join(root, group, ...segments) },
    () => operation(root),
  )
}

describe('knowledge base directory', () => {
  it('initializes new knowledge bases with an empty directory', () => fixture(() => {
    const kb = createKnowledgeBase({ name: '产品资料' })
    expect(kb.directory).toEqual([])
    expect(getKnowledgeBase(kb.id)?.directory).toEqual([])
  }))

  it('normalizes legacy knowledge bases without a directory', () => fixture((root) => {
    const directory = join(root, 'knowledge', 'knowledge-bases')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'legacy.json'), JSON.stringify({
      id: 'legacy', name: '旧知识库', description: '', providerId: 'sqlite-vec',
      config: { dimensions: 1536, similarityThreshold: 0.7, topK: 5 },
      documentCount: 0, chunkCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(getKnowledgeBase('legacy')?.directory).toEqual([])
  }))

  it('appends one entry per document and removes only one duplicate', () => fixture(() => {
    const kb = createKnowledgeBase({ name: '项目资料' })

    recordKnowledgeBaseDocumentAdded(kb.id, '方案.pdf', { documentCount: 1, chunkCount: 3 })
    recordKnowledgeBaseDocumentAdded(kb.id, '方案.pdf', { documentCount: 2, chunkCount: 6 })
    recordKnowledgeBaseDocumentAdded(kb.id, '预算.xlsx', { documentCount: 3, chunkCount: 8 })
    expect(getKnowledgeBase(kb.id)).toMatchObject({
      directory: ['方案.pdf', '方案.pdf', '预算.xlsx'],
      documentCount: 3,
      chunkCount: 8,
    })

    recordKnowledgeBaseDocumentRemoved(kb.id, '方案.pdf', { documentCount: 2, chunkCount: 5 })
    expect(getKnowledgeBase(kb.id)).toMatchObject({
      directory: ['方案.pdf', '预算.xlsx'],
      documentCount: 2,
      chunkCount: 5,
    })
  }))

  it('matches knowledge bases by a directory filename', () => fixture(() => {
    const finance = createKnowledgeBase({ name: '财务资料' })
    const product = createKnowledgeBase({ name: '产品资料' })
    recordKnowledgeBaseDocumentAdded(finance.id, '2026-Q2-经营报告.xlsx', { documentCount: 1, chunkCount: 2 })
    recordKnowledgeBaseDocumentAdded(product.id, '需求说明.md', { documentCount: 1, chunkCount: 1 })

    expect(listKnowledgeBases('经营报告').map((kb) => kb.id)).toEqual([finance.id])
  }))

  it('waits for an async content publisher before reading sync knowledge metadata', async () => fixture(async (root) => {
    const kb = createKnowledgeBase({ name: '并发资料' })
    let releasePublisher!: () => void
    let publisherEntered!: () => void
    const publisherGate = new Promise<void>((resolve) => { releasePublisher = resolve })
    const entered = new Promise<void>((resolve) => { publisherEntered = resolve })
    const publisher = withVolumeContentStoreLease(root, async () => {
      publisherEntered()
      await publisherGate
    })
    await entered

    const reading = retryContentStoreLease(() => getKnowledgeBase(kb.id), { timeoutMs: 1_000, retryIntervalMs: 5 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    releasePublisher()

    await expect(reading).resolves.toMatchObject({ id: kb.id, name: '并发资料' })
    await publisher
  }))
})
