import type { FastifyInstance } from 'fastify'
import { probeAllRunners } from '../core/engine/runner'

export async function runnerRoutes(app: FastifyInstance) {
  // GET /api/runners/probe — 探测所有 Runner
  app.get('/api/runners/probe', async (_request, reply) => {
    try {
      const results = await probeAllRunners()
      return reply.send({ runners: results })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
