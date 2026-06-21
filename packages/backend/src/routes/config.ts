import type { FastifyInstance } from 'fastify'
import { getLLMConfig } from '../core/llm/config-store'
import { apiSuccess, apiError } from '../core/api/error-handler'

export async function configRoutes(app: FastifyInstance) {
  // GET /api/config — 获取 LLM 配置
  app.get('/api/config', async (_request, reply) => {
    try {
      const config = getLLMConfig()
      return reply.send(apiSuccess(config))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
