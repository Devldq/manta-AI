import type { FastifyInstance } from 'fastify'
import { loadAgents } from '../registry'

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (request, reply) => {
    try {
      const { enabled } = request.query as { enabled?: string }
      const agents = loadAgents()
      const result = enabled === 'true' ? agents.filter((a) => a.enabled) : agents
      return reply.send({ agents: result })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
