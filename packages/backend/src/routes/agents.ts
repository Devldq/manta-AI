import type { FastifyInstance } from 'fastify'
import { loadAgents } from '../registry'

export async function agentRoutes(app: FastifyInstance) {
  // GET /api/agents — 获取 Agent 列表
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

  // GET /api/agents/names — 获取 Agent 名称列表（用于 Skill 绑定选择器）
  app.get('/api/agents/names', async (_request, reply) => {
    try {
      const agents = loadAgents()
      const names = agents.map((a) => ({
        name: a.name,
        label: a.name,
        enabled: a.enabled,
      }))
      return reply.send({ agents: names })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
