import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createRagUploadStorage } from './rag-upload-storage'

describe('RAG original document storage', () => {
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

  it('removes staged and persistent files when processing fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-upload-fail-'))
    const storage = createRagUploadStorage({
      cacheUploadsRoot: join(root, 'cache', 'uploads'),
      documentsRoot: join(root, 'knowledge', 'documents'),
    })
    await expect(storage.ingest(Readable.from(['broken']), 'broken.txt', async () => {
      throw new Error('pipeline failed')
    })).rejects.toThrow(/pipeline failed/)
    expect(readdirSync(join(root, 'cache', 'uploads'))).toEqual([])
    expect(existsSync(join(root, 'knowledge', 'documents')) ? readdirSync(join(root, 'knowledge', 'documents')) : []).toEqual([])
  })
})
