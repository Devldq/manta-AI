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
})
