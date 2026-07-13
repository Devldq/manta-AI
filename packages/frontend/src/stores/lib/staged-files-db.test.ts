import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadStagedFiles, removeStagedFileById, saveStagedFiles } from './staged-files-db'

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
})
