import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadStagedFiles, removeStagedFileById, removeStagedFilesById, saveStagedFiles } from './staged-files-db'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('ASH RAG staging client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads a staged file, then restores its canonical server reference after refresh', async () => {
    const id = 'a'.repeat(64)
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/content')) return new Response(new Blob(['durable'], { type: 'text/plain' }))
      if (init?.method === 'POST') return response({ success: true, data: { entry: { id, kbId: 'kb', name: 'a.txt', size: 7, type: 'text/plain', sha256: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() } } }, 201)
      return response({ success: true, data: { entries: [{ id, kbId: 'kb', name: 'a.txt', size: 7, type: 'text/plain', sha256: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    const saved = await saveStagedFiles('kb', [{ id: 'local-a', file: new File(['durable'], 'a.txt', { type: 'text/plain' }), name: 'a.txt', size: 7, type: 'text/plain' }])
    expect(saved[0].id).toBe(id)
    const restored = await loadStagedFiles('kb')
    expect(await restored[0].file.text()).toBe('durable')
    await removeStagedFileById(id, 'kb')
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(id), expect.objectContaining({ method: 'DELETE' }))
  })

  it('keeps an offline file only in memory and does not claim it was durable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const file = new File(['retry'], 'retry.txt')
    await expect(saveStagedFiles('offline-kb', [{ id: 'local-retry', file, name: file.name, size: file.size, type: file.type }])).rejects.toThrow('offline')
    const restored = await loadStagedFiles('offline-kb')
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('local-retry')
  })

  it('merges failed local uploads into a successful canonical refresh and retries them', async () => {
    const canonicalId = 'b'.repeat(64)
    const retryId = 'c'.repeat(64)
    let online = false
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (!online) throw new Error('offline')
        return response({ success: true, data: { entry: { id: retryId, kbId: 'merge-kb', name: 'retry.txt', size: 5, type: 'text/plain', sha256: retryId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() } } }, 201)
      }
      if (String(url).endsWith('/content')) return new Response(new Blob(['canonical']))
      return response({ success: true, data: { entries: [{ id: canonicalId, kbId: 'merge-kb', name: 'canonical.txt', size: 9, type: 'text/plain', sha256: canonicalId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(saveStagedFiles('merge-kb', [{ id: 'local-retry', file: new File(['retry'], 'retry.txt', { type: 'text/plain' }), name: 'retry.txt', size: 5, type: 'text/plain' }])).rejects.toThrow('offline')
    online = true
    const merged = await loadStagedFiles('merge-kb')
    expect(merged.map((file) => file.id).sort()).toEqual([canonicalId, retryId].sort())
    expect(fetcher).toHaveBeenCalledWith('/api/storage/rag-staging/merge-kb', expect.objectContaining({ method: 'POST' }))
  })

  it('retries a failed upload when an otherwise empty canonical list becomes reachable', async () => {
    const id = 'e'.repeat(64)
    let online = false
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (!online) throw new Error('offline')
        return response({ success: true, data: { entry: { id, kbId: 'empty-kb', name: 'retry.txt', size: 5, type: 'text/plain', sha256: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() } } }, 201)
      }
      return response({ success: true, data: { entries: [] } })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(saveStagedFiles('empty-kb', [{ id: 'local-empty-retry', file: new File(['retry'], 'retry.txt', { type: 'text/plain' }), name: 'retry.txt', size: 5, type: 'text/plain' }])).rejects.toThrow('offline')
    online = true
    expect((await loadStagedFiles('empty-kb')).map((file) => file.id)).toEqual([id])
  })

  it('keeps a canonical file visible when its remote delete fails', async () => {
    const id = 'd'.repeat(64)
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return response({ success: false, error: { message: 'offline' } }, 503)
      if (String(url).endsWith('/content')) return new Response(new Blob(['still-here']))
      return response({ success: true, data: { entries: [{ id, kbId: 'delete-kb', name: 'keep.txt', size: 10, type: 'text/plain', sha256: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(removeStagedFileById(id, 'delete-kb')).rejects.toThrow('503')
    const reloaded = await loadStagedFiles('delete-kb')
    expect(reloaded.map((file) => file.id)).toEqual([id])
  })

  it('acknowledges each canonical deletion independently and retains failures for retry', async () => {
    const fetcher = vi.fn(async (input: string) => new Response(null, { status: input.endsWith('/a') ? 204 : 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(removeStagedFilesById('kb-1', ['a', 'b'])).resolves.toEqual({ deletedIds: ['a'], failures: [{ id: 'b', error: expect.any(Error) }] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
