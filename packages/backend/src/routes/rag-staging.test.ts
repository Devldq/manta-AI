import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { describe, expect, it } from 'vitest'
import { ragStagingRoutes } from './rag-staging'
import { RagStagingStore } from '../storage/rag-staging-store'
import { runWithStorageResolver } from '../storage/path-routing'

describe('RAG cache staging routes', () => {
  it('streams staged content with a header-safe UTF-8 filename', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-route-utf8-'))
    const app = Fastify(); await app.register(multipart); await app.register(ragStagingRoutes, new RagStagingStore()); app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver({ resolve: (_group, ...segments) => join(root, ...segments) }, done))
    const boundary = 'rag-staging-utf8-boundary'
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="文档.md"\r\nContent-Type: text/markdown\r\n\r\nUTF-8 content\r\n--${boundary}--\r\n`)
    const uploaded = await app.inject({ method: 'POST', url: '/api/storage/rag-staging/kb-utf8', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload })
    const entry = uploaded.json().data.entry

    const restored = await app.inject(`/api/storage/rag-staging/kb-utf8/${entry.id}/content`)

    expect(restored.statusCode).toBe(200)
    expect(restored.body).toBe('UTF-8 content')
    expect(restored.headers['content-disposition']).toContain("filename*=UTF-8''")
    await app.close()
  })

  it('uploads, restores, claims, reads and deletes an ASH cache object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-route-'))
    const app = Fastify(); await app.register(multipart); await app.register(ragStagingRoutes, new RagStagingStore()); app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver({ resolve: (_group, ...segments) => join(root, ...segments) }, done))
    const boundary = 'rag-staging-test-boundary'
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncache me\r\n--${boundary}--\r\n`)
    const uploaded = await app.inject({ method: 'POST', url: '/api/storage/rag-staging/kb-a', headers: { 'x-manta-idempotency-key': 'retry-a', 'content-type': `multipart/form-data; boundary=${boundary}` }, payload })
    expect(uploaded.statusCode).toBe(201); const entry = uploaded.json().data.entry
    expect((await app.inject('/api/storage/rag-staging/kb-a')).json().data.entries).toHaveLength(1)
    expect((await app.inject({ method: 'POST', url: '/api/storage/rag-staging/kb-a/claim', payload: { ids: [entry.id], sessionId: 'batch-a' } })).json().data.entries[0].sessionId).toBe('batch-a')
    expect((await app.inject(`/api/storage/rag-staging/kb-a/${entry.id}/content`)).body).toBe('cache me')
    expect((await app.inject({ method: 'DELETE', url: `/api/storage/rag-staging/kb-a/${entry.id}` })).statusCode).toBe(204)
    await app.close()
  })

  it('removes expired cache entries before listing them through the production route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-rag-route-expiry-'))
    const app = Fastify()
    await app.register(multipart)
    await app.register(ragStagingRoutes, new RagStagingStore({ ttlMs: 1 }))
    app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver({ resolve: (_group, ...segments) => join(root, ...segments) }, done))
    const boundary = 'rag-staging-expiry-boundary'
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncache me\r\n--${boundary}--\r\n`)
    expect((await app.inject({ method: 'POST', url: '/api/storage/rag-staging/kb-expiry', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload })).statusCode).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await app.inject('/api/storage/rag-staging/kb-expiry')).json().data.entries).toEqual([])
    await app.close()
  })
})
