import type { FastifyInstance } from 'fastify'
import { fetchApps, createNewApp, updateExistingApp, deleteExistingApp } from '../core/services/app.service'
import { apiSuccess, apiError } from '../core/api/error-handler'

export async function appRoutes(app: FastifyInstance) {
  // GET /api/apps — 获取应用列表
  app.get('/api/apps', async (_request, reply) => {
    try {
      const apps = fetchApps()
      return reply.send(apiSuccess(apps))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/apps — 创建应用
  app.post('/api/apps', async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof createNewApp>[0]
      const created = createNewApp(body)
      return reply.status(201).send(apiSuccess(created))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/apps/:id — 更新应用
  app.put('/api/apps/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Parameters<typeof updateExistingApp>[1]
      const updated = updateExistingApp(id, body)
      return reply.send(apiSuccess(updated))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/apps/:id — 删除应用
  app.delete('/api/apps/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      deleteExistingApp(id)
      return reply.send(apiSuccess({ deleted: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
