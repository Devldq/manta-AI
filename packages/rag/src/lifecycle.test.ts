import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  configureSQLiteVecProvider,
  EmbeddingCacheManager,
  getSQLiteVecProvider,
  resetSQLiteVecProvider,
  SQLiteVecProvider,
} from './index'

describe('managed SQLite lifecycle', () => {
  it('requires an explicit storage directory', () => {
    expect(() => new SQLiteVecProvider(undefined as never)).toThrow(/storage directory/i)
    expect(() => new EmbeddingCacheManager(undefined as never)).toThrow(/cache directory/i)
  })

  it('checkpoints, validates, closes, and reopens a knowledge database', async () => {
    const first = mkdtempSync(join(tmpdir(), 'manta-rag-'))
    const second = mkdtempSync(join(tmpdir(), 'manta-rag-'))
    const provider = new SQLiteVecProvider(first)
    await provider.initialize()
    await provider.createKnowledgeBase('kb', 'Knowledge')
    expect(await provider.integrityCheck()).toEqual({ ok: true })
    await provider.checkpoint()
    await provider.close()
    await provider.reopen(second)
    await provider.createKnowledgeBase('kb2', 'Knowledge 2')
    expect((await provider.getStats('kb2')).documentCount).toBe(0)
    await provider.close()
  })

  it('allows an embedding cache to checkpoint, close, and reopen', async () => {
    const first = mkdtempSync(join(tmpdir(), 'manta-cache-'))
    const second = mkdtempSync(join(tmpdir(), 'manta-cache-'))
    const cache = new EmbeddingCacheManager(first)
    cache.set('hello', 'model', [1, 2])
    expect(cache.integrityCheck()).toEqual({ ok: true })
    cache.checkpoint()
    cache.close()
    cache.reopen(second)
    cache.set('world', 'model', [3, 4])
    expect(cache.get('world', 'model')).toEqual([3, 4])
    cache.close()
  })

  it('persists the original document reference with document metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-source-'))
    const provider = new SQLiteVecProvider(root)
    await provider.createKnowledgeBase('kb', 'Knowledge')
    await provider.addDocument('kb', {
      id: 'doc', name: 'source.txt', type: 'text/plain', size: 4,
      uploadedAt: new Date().toISOString(), status: 'processing',
      sourcePath: 'documents/abc-source.txt', sourceSha256: 'abc',
    }, [])
    await provider.close()

    const reopened = new SQLiteVecProvider(root)
    expect(await reopened.getDocument('doc')).toEqual(expect.objectContaining({
      sourcePath: 'documents/abc-source.txt', sourceSha256: 'abc',
    }))
    await reopened.close()
  })

  it('resets the compatibility provider before it can be reconfigured', async () => {
    const first = mkdtempSync(join(tmpdir(), 'manta-rag-global-'))
    const second = mkdtempSync(join(tmpdir(), 'manta-rag-global-'))
    expect(configureSQLiteVecProvider(first)).toBe(getSQLiteVecProvider())
    expect(() => configureSQLiteVecProvider(second)).toThrow(/already configured/i)
    await resetSQLiteVecProvider()
    expect(() => getSQLiteVecProvider()).toThrow(/not been configured/i)
    configureSQLiteVecProvider(second)
    await resetSQLiteVecProvider()
  })
})
