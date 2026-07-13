import type { FastifyInstance } from 'fastify'
import type { RagStagingStore } from '../storage/rag-staging-store'

function message(error: unknown): string { return error instanceof Error ? error.message : 'RAG staging failed' }

/** Renderer queue API: bytes are durable only after this cache-group endpoint succeeds. */
export async function ragStagingRoutes(app: FastifyInstance, store: RagStagingStore): Promise<void> {
  // Cache cleanup mutates the same files as list/read/claim.  Queue cleanup
  // passes so concurrent production requests cannot race two expiry sweeps.
  let cleanupTail: Promise<void> = Promise.resolve()
  const cleanupExpired = (): Promise<void> => {
    const next = cleanupTail.then(async () => { await store.cleanupExpired() })
    cleanupTail = next.catch(() => undefined)
    return next
  }
  app.post<{ Params: { kbId: string } }>('/api/storage/rag-staging/:kbId', async (request, reply) => {
    try {
      const part = await request.file()
      if (!part) return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_FILE_REQUIRED', message: 'A file is required' } })
      const entry = await store.stage(request.params.kbId, part.file, { name: part.filename, type: part.mimetype, idempotencyKey: typeof request.headers['x-manta-idempotency-key'] === 'string' ? request.headers['x-manta-idempotency-key'] : undefined })
      return reply.status(201).send({ success: true, data: { entry } })
    } catch (error) { return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_FAILED', message: message(error) } }) }
  })
  app.get<{ Params: { kbId: string } }>('/api/storage/rag-staging/:kbId', async (request, reply) => {
    try { await cleanupExpired(); return { success: true, data: { entries: await store.list(request.params.kbId) } } }
    catch (error) { return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_LIST_FAILED', message: message(error) } }) }
  })
  app.get<{ Params: { kbId: string; id: string } }>('/api/storage/rag-staging/:kbId/:id/content', async (request, reply) => {
    try { const entry = await store.read(request.params.kbId, request.params.id); return reply.type(entry.type).header('Content-Disposition', `attachment; filename="${entry.name.replaceAll('"', '')}"`).send(await import('node:fs').then(({ createReadStream }) => createReadStream(store.pathFor(request.params.kbId, entry.id)))) }
    catch (error) { return reply.status(404).send({ success: false, error: { code: 'RAG_STAGE_NOT_FOUND', message: message(error) } }) }
  })
  app.delete<{ Params: { kbId: string; id: string } }>('/api/storage/rag-staging/:kbId/:id', async (request, reply) => {
    try { await store.remove(request.params.kbId, request.params.id); return reply.status(204).send() }
    catch (error) { return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_DELETE_FAILED', message: message(error) } }) }
  })
  app.post<{ Params: { kbId: string }; Body: { ids?: string[]; sessionId?: string } }>('/api/storage/rag-staging/:kbId/claim', async (request, reply) => {
    if (!Array.isArray(request.body?.ids) || !request.body.sessionId) return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_CLAIM_INVALID', message: 'ids and sessionId are required' } })
    try { return { success: true, data: { entries: await store.claim(request.params.kbId, request.body.ids, request.body.sessionId) } } }
    catch (error) { return reply.status(400).send({ success: false, error: { code: 'RAG_STAGE_CLAIM_FAILED', message: message(error) } }) }
  })
}
