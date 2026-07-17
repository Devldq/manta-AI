import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from '../../../storage/path-routing'
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
})
