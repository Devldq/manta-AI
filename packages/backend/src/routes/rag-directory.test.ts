import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createKnowledgeBase, getKnowledgeBase } from '../core/storage/knowledge-base/store'
import { runWithStorageResolver } from '../storage/path-routing'
import {
  recordUploadedRagDocument,
  removeRagDocumentAndRecordDirectory,
} from './rag-directory'

function fixture<T>(operation: () => T): T {
  const root = mkdtempSync(join(tmpdir(), 'manta-rag-route-directory-'))
  return runWithStorageResolver(
    { resolve: (group, ...segments) => join(root, group, ...segments) },
    operation,
  )
}

describe('RAG route directory updates', () => {
  it('records the uploaded filename with refreshed counts', () => fixture(async () => {
    const kb = createKnowledgeBase({ name: '资料库' })

    await recordUploadedRagDocument(kb.id, '路线图.md', { documentCount: 1, chunkCount: 4 })

    expect(getKnowledgeBase(kb.id)).toMatchObject({
      directory: ['路线图.md'],
      documentCount: 1,
      chunkCount: 4,
    })
  }))

  it('reads the document name before deletion and removes one directory entry', () => fixture(async () => {
    const kb = createKnowledgeBase({ name: '资料库' })
    await recordUploadedRagDocument(kb.id, '路线图.md', { documentCount: 1, chunkCount: 4 })
    const events: string[] = []
    const provider = {
      getDocument: vi.fn(async () => {
        events.push('read')
        return { name: '路线图.md' }
      }),
      removeDocument: vi.fn(async () => {
        events.push('delete')
      }),
      getStats: vi.fn(async () => ({ documentCount: 0, chunkCount: 0, totalSize: 0 })),
    }

    const removed = await removeRagDocumentAndRecordDirectory(kb.id, 'doc-1', provider)

    expect(events).toEqual(['read', 'delete'])
    expect(removed?.name).toBe('路线图.md')
    expect(getKnowledgeBase(kb.id)).toMatchObject({ directory: [], documentCount: 0, chunkCount: 0 })
  }))
})
