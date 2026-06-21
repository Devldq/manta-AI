import type { FastifyInstance } from 'fastify'
import { getWorkspaceConfig, setDefaultWorkDir, addRecentDir } from '../core/storage/config/workspace-store'
import * as fs from 'fs'
import * as path from 'path'

export async function configWorkspaceRoutes(app: FastifyInstance) {
  // GET /api/config/workspace — 获取工作空间配置
  app.get('/api/config/workspace', async (_request, reply) => {
    try {
      const config = getWorkspaceConfig()
      return reply.send({ config })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/config/workspace — 更新工作空间配置
  app.post('/api/config/workspace', async (request, reply) => {
    try {
      const body = request.body as Record<string, string>

      if (body.setDefaultDir) {
        const dir = body.setDefaultDir
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return reply.status(400).send({ error: `目录不存在或不是有效目录: ${dir}` })
        }
        setDefaultWorkDir(dir)
        return reply.send({ success: true, defaultDir: path.resolve(dir) })
      }

      if (body.addRecentDir) {
        addRecentDir(body.addRecentDir)
        return reply.send({ success: true })
      }

      return reply.status(400).send({ error: '未知操作' })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
