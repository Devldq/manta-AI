import type { FastifyInstance } from 'fastify'
import { apiSuccess, apiError } from '../core/api/error-handler'

export async function toolRoutes(app: FastifyInstance) {
  // GET /api/tools — 获取可用工具列表
  app.get('/api/tools', async (request, reply) => {
    try {
      const { getToolRegistry } = await import('../core/tools/mcp/setup')
      const registry = await getToolRegistry()

      const category = (request.query as Record<string, string>).category
      let tools = registry.getAll().map(tool => ({
        name: tool.name,
        description: tool.description,
        category: tool.mcpServer ? 'mcp' : 'builtin',
        mcpServer: tool.mcpServer,
        isReadOnly: tool.isReadOnly,
        isConcurrencySafe: tool.isConcurrencySafe,
      }))

      // 按类别过滤
      if (category === 'builtin') {
        tools = tools.filter(t => t.category === 'builtin')
      } else if (category === 'mcp') {
        tools = tools.filter(t => t.category === 'mcp')
      }

      return reply.send(apiSuccess({ tools, total: tools.length }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
