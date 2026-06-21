import type { FastifyInstance } from 'fastify'
import { apiSuccess, apiError, apiHandler, Errors } from '../core/api/error-handler'
import { listWorkflows, createWorkflow, getWorkflow, updateWorkflow, deleteWorkflow } from '../core/storage/workflow/store'

export async function workflowRoutes(app: FastifyInstance) {
  // GET /api/workflow — 获取工作流列表
  app.get('/api/workflow', async (request, reply) => {
    try {
      const search = (request.query as Record<string, string>).search?.toLowerCase()
      let workflows = listWorkflows()
      if (search) {
        workflows = workflows.filter(wf => wf.name.toLowerCase().includes(search) || (wf.description && wf.description.toLowerCase().includes(search)))
      }
      return reply.send(apiSuccess({ workflows }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/workflow — 创建工作流
  app.post('/api/workflow', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const body = request.body as { name?: string; description?: string; steps?: any[] }
        if (!body.name?.trim()) throw Errors.VALIDATION_ERROR('name', '工作流名称不能为空')
        const workflow = createWorkflow({ name: body.name.trim(), description: body.description?.trim(), steps: body.steps })
        return { workflow }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/workflow/:id — 获取单个工作流
  app.get('/api/workflow/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const workflow = getWorkflow(id)
      if (!workflow) throw Errors.NOT_FOUND('工作流', id)
      return reply.send(apiSuccess({ workflow }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/workflow/:id — 更新工作流
  app.put('/api/workflow/:id', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as Record<string, unknown>
        const workflow = updateWorkflow(id, body)
        if (!workflow) throw Errors.NOT_FOUND('工作流', id)
        return { workflow }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workflow/:id — 删除工作流
  app.delete('/api/workflow/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const ok = deleteWorkflow(id)
      if (!ok) throw Errors.NOT_FOUND('工作流', id)
      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
