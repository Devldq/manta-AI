import type { FastifyInstance } from 'fastify'
import { createFsTools } from '../core/tools'

export async function toolsTestRoutes(app: FastifyInstance) {
  // POST /api/tools/test — 测试工具
  app.post('/api/tools/test', async (request, reply) => {
    try {
      const fsTools = createFsTools()
      const tools = new Map<string, (typeof fsTools)[0]>()
      for (const tool of fsTools) tools.set(tool.name, tool)

      const { toolName, input } = request.body as { toolName?: string; input?: unknown }
      if (!toolName || typeof toolName !== 'string') {
        return reply.status(400).send({ error: '缺少 toolName 参数' })
      }

      const tool = tools.get(toolName)
      if (!tool) {
        return reply.status(404).send({ error: `工具不存在: ${toolName}`, available: Array.from(tools.keys()) })
      }

      const result = await tool.execute(input)
      return reply.send({ toolName, input, result })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
