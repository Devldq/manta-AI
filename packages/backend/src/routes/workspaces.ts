import type { FastifyInstance } from 'fastify'
import { fetchWorkspaces, createNewWorkspace, updateExistingWorkspace, deleteExistingWorkspace } from '../core/services/workspace.service'
import { apiSuccess, apiError } from '../core/api/error-handler'

export async function workspaceRoutes(app: FastifyInstance) {
  // GET /api/workspaces — 获取工作空间列表
  app.get('/api/workspaces', async (_request, reply) => {
    try {
      const workspaces = fetchWorkspaces()
      return reply.send(apiSuccess(workspaces))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/workspaces — 创建工作空间
  app.post('/api/workspaces', async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof createNewWorkspace>[0]
      const workspace = createNewWorkspace(body)
      return reply.status(201).send(apiSuccess(workspace))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/workspaces/:id — 更新工作空间
  app.put('/api/workspaces/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Parameters<typeof updateExistingWorkspace>[1]
      const workspace = updateExistingWorkspace(id, body)
      return reply.send(apiSuccess(workspace))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workspaces/:id — 删除工作空间
  app.delete('/api/workspaces/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      deleteExistingWorkspace(id)
      return reply.send(apiSuccess({ deleted: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
