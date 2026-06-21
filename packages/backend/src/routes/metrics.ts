import type { FastifyInstance } from 'fastify'
import { getSession, getLastTurn, getToolStats } from '../core/observability/metrics'

export async function metricsRoutes(app: FastifyInstance) {
  // GET /api/metrics — 查询实时运行指标
  app.get('/api/metrics', async (request, reply) => {
    const conversationId = (request.query as Record<string, string>).conversationId
    if (!conversationId) {
      return reply.status(400).send({ error: 'conversationId is required' })
    }

    const session = getSession(conversationId)
    const lastTurn = getLastTurn(conversationId)
    const toolStats = getToolStats(conversationId)

    return reply.send({
      session: session ?? null,
      lastTurn: lastTurn ?? null,
      toolStats,
    })
  })
}
