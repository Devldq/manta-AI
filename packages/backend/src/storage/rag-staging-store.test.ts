import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { RagStagingStore } from './rag-staging-store'
import { runWithStorageResolver } from './path-routing'

describe('RagStagingStore', () => {
  it('persists, restores, claims, and removes a cache-owned staged file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-staging-'))
    const store = new RagStagingStore()
    const resolve = (_group: string, ...segments: string[]) => join(root, ...segments)
    const saved = await runWithStorageResolver({ resolve } as any, () => store.stage('kb-a', Readable.from(['hello']), { name: '../../notes.txt', type: 'text/plain', idempotencyKey: 'same-file' }))
    expect(saved.name).toBe('notes.txt')
    expect(saved.size).toBe(5)
    expect((await runWithStorageResolver({ resolve } as any, () => store.stage('kb-a', Readable.from(['hello']), { name: 'notes.txt', type: 'text/plain', idempotencyKey: 'same-file' }))).id).toBe(saved.id)
    expect(await readFile(runWithStorageResolver({ resolve } as any, () => store.pathFor('kb-a', saved.id)), 'utf8')).toBe('hello')
    expect((await runWithStorageResolver({ resolve } as any, () => store.list('kb-a'))).map((entry) => entry.id)).toEqual([saved.id])
    expect((await runWithStorageResolver({ resolve } as any, () => store.claim('kb-a', [saved.id], 'batch-a'))).map((entry) => entry.sessionId)).toEqual(['batch-a'])
    await runWithStorageResolver({ resolve } as any, () => store.remove('kb-a', saved.id))
    expect(await runWithStorageResolver({ resolve } as any, () => store.list('kb-a'))).toEqual([])
  })

  it('expires old entries and rejects unsafe identifiers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-staging-'))
    const store = new RagStagingStore({ ttlMs: 1 })
    const resolve = (_group: string, ...segments: string[]) => join(root, ...segments)
    const saved = await runWithStorageResolver({ resolve } as any, () => store.stage('kb-a', Readable.from(['x']), { name: 'x.txt', type: 'text/plain' }))
    await new Promise((resolve) => setTimeout(resolve, 3))
    expect(await runWithStorageResolver({ resolve } as any, () => store.cleanupExpired())).toContain(saved.id)
    await expect(runWithStorageResolver({ resolve } as any, () => store.list('../bad'))).rejects.toThrow(/unsafe/i)
  })
})
