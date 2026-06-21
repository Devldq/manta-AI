import type { FastifyInstance } from 'fastify'
import { grantAccess, denyAccess, listPendingRequests, requestAccess } from '../core/security/fs-access'

export async function fsRoutes(app: FastifyInstance) {
  // GET /api/fs/request-access — 获取所有 pending 的授权请求
  app.get('/api/fs/request-access', async (_request, reply) => {
    return reply.send(listPendingRequests())
  })

  // POST /api/fs/request-access — 发起授权请求
  app.post('/api/fs/request-access', async (request, reply) => {
    const body = request.body as { path?: string }
    if (!body.path || typeof body.path !== 'string') {
      return reply.status(400).send({ error: '缺少 path 参数' })
    }
    const req = requestAccess(body.path)
    return reply.send(req)
  })

  // POST /api/fs/grant-access — 批准或拒绝授权请求
  app.post('/api/fs/grant-access', async (request, reply) => {
    const body = request.body as { requestId?: string; action?: string }
    if (!body.requestId || typeof body.requestId !== 'string') {
      return reply.status(400).send({ error: '缺少 requestId 参数' })
    }
    if (body.action !== 'grant' && body.action !== 'deny') {
      return reply.status(400).send({ error: 'action 必须为 grant 或 deny' })
    }
    const ok = body.action === 'grant' ? grantAccess(body.requestId) : denyAccess(body.requestId)
    if (!ok) return reply.status(404).send({ error: `授权请求 ${body.requestId} 不存在` })
    return reply.send({ success: true, action: body.action })
  })
}
