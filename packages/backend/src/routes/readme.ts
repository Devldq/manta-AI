import type { FastifyInstance } from 'fastify'
import { readFile } from 'fs/promises'
import { join } from 'path'

export async function readmeRoutes(app: FastifyInstance) {
  // GET /api/readme — 读取 README.md
  app.get('/api/readme', async (_request, reply) => {
    try {
      const readmePath = join(process.cwd(), 'README.md')
      const content = await readFile(readmePath, 'utf-8')
      return reply.send({ content })
    } catch {
      return reply.send({ content: '# 暂无说明\n\nREADME.md 文件未找到。' })
    }
  })
}
