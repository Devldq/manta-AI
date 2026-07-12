import type { FastifyInstance } from 'fastify'
import type { ClientStateStore } from '../storage/client-state-store'

const validKeys = new Set(['theme', 'sidebar', 'webhook', 'browser-import'])
function validKey(key: string): boolean { return validKeys.has(key) }

export async function storageClientStateRoutes(app: FastifyInstance, store: ClientStateStore): Promise<void> {
  app.get<{ Params: { key: string } }>('/api/storage/client-state/:key', async (request, reply) => {
    if (!validKey(request.params.key)) return reply.status(404).send({ success: false, error: { code: 'CLIENT_STATE_NOT_FOUND', message: 'Unknown client state' } })
    try {
      const state = await store.get(request.params.key)
      if (!state) return reply.status(404).send({ success: false, error: { code: 'CLIENT_STATE_NOT_FOUND', message: 'Client state was not found' } })
      return { success: true, data: state }
    } catch (error) {
      return reply.status(409).send({ success: false, error: { code: 'CLIENT_STATE_CORRUPT', message: error instanceof Error ? error.message : 'Client state is corrupt' } })
    }
  })
  app.put<{ Params: { key: string }; Body: { value?: unknown } }>('/api/storage/client-state/:key', async (request, reply) => {
    if (!validKey(request.params.key)) return reply.status(404).send({ success: false, error: { code: 'CLIENT_STATE_NOT_FOUND', message: 'Unknown client state' } })
    if (!request.body || !Object.prototype.hasOwnProperty.call(request.body, 'value')) return reply.status(400).send({ success: false, error: { code: 'INVALID_CLIENT_STATE', message: 'A JSON value is required' } })
    if (typeof request.body.value !== 'object' || request.body.value === null || Array.isArray(request.body.value)) return reply.status(400).send({ success: false, error: { code: 'INVALID_CLIENT_STATE', message: 'A JSON object is required' } })
    try { return { success: true, data: await store.put(request.params.key, request.body.value as Record<string, unknown>) } }
    catch (error) { return reply.status(400).send({ success: false, error: { code: 'INVALID_CLIENT_STATE', message: error instanceof Error ? error.message : 'Invalid client state' } }) }
  })
}
