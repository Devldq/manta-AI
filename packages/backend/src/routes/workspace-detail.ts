import type { FastifyInstance } from 'fastify'
import { apiSuccess, apiError, apiHandler, Errors, validateWithZod } from '../core/api/error-handler'
import { BindEntitySchema } from '@manta/shared'
import { getWorkspaceById, updateExistingWorkspace, deleteExistingWorkspace, bindAgentApps, unbindAgentApps, bindKnowledgeBases, unbindKnowledgeBases, bindWorkflows, unbindWorkflows } from '../core/services/workspace.service'
import { getWorkspace } from '../core/storage/workspace/store'
import { fetchConversations, createNewConversation } from '../core/services/conversation.service'

export async function workspaceDetailRoutes(app: FastifyInstance) {
  // GET /api/workspaces/:id — 获取单个工作空间
  app.get('/api/workspaces/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const workspace = getWorkspaceById(id)
      if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
      return reply.send(apiSuccess({ workspace }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/workspaces/:id — 更新工作空间
  app.put('/api/workspaces/:id', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as Record<string, unknown>
        const workspace = updateExistingWorkspace(id, body)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workspaces/:id — 删除工作空间
  app.delete('/api/workspaces/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const ok = deleteExistingWorkspace(id)
      if (!ok) throw Errors.NOT_FOUND('工作空间', id)
      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/workspaces/:id/agent-apps — 绑定 Agent 应用
  app.post('/api/workspaces/:id/agent-apps', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = bindAgentApps(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workspaces/:id/agent-apps — 解绑 Agent 应用
  app.delete('/api/workspaces/:id/agent-apps', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = unbindAgentApps(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/workspaces/:id/conversations — 获取工作空间会话列表
  app.get('/api/workspaces/:id/conversations', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const workspace = getWorkspace(id)
      if (!workspace) return reply.status(404).send({ error: '工作空间不存在' })
      const conversations = fetchConversations({ type: 'workspace', workspaceId: id })
      return reply.send({ success: true, data: { conversations } })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/workspaces/:id/conversations — 创建工作空间会话
  app.post('/api/workspaces/:id/conversations', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const workspace = getWorkspace(id)
      if (!workspace) return reply.status(404).send({ error: '工作空间不存在' })

      const body = request.body as { agentName?: string; title?: string }
      const conversation = createNewConversation({
        agentName: body.agentName || 'default',
        title: body.title,
        type: 'workspace',
        workspaceId: id,
      })
      return reply.send({ success: true, data: { conversation } })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/workspaces/:id/knowledge-bases — 绑定知识库
  app.post('/api/workspaces/:id/knowledge-bases', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = bindKnowledgeBases(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workspaces/:id/knowledge-bases — 解绑知识库
  app.delete('/api/workspaces/:id/knowledge-bases', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = unbindKnowledgeBases(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/workspaces/:id/workflows — 绑定工作流
  app.post('/api/workspaces/:id/workflows', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = bindWorkflows(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/workspaces/:id/workflows — 解绑工作流
  app.delete('/api/workspaces/:id/workflows', async (request, reply) => {
    try {
      const result = await apiHandler(async () => {
        const { id } = request.params as { id: string }
        const body = request.body as { entityIds?: string[] }
        const { entityIds } = validateWithZod(BindEntitySchema, body)
        const workspace = unbindWorkflows(id, entityIds)
        if (!workspace) throw Errors.NOT_FOUND('工作空间', id)
        return { workspace }
      })
      return reply.send(result)
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
