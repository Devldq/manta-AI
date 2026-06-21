import type { FastifyInstance } from 'fastify'
import { listConversations, createConversation, deleteConversation } from '../core/storage/conversation/store'

/**
 * 任务路由 — 向后兼容 /api/tasks 端点
 * 在新架构中，"任务"等同于"会话"(Conversation)
 */
export async function taskRoutes(app: FastifyInstance) {
  // GET /api/tasks — 获取任务列表（映射到会话列表）
  app.get('/api/tasks', async (_request, reply) => {
    try {
      const conversations = listConversations()
      return reply.send({ success: true, data: conversations })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to get tasks', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // POST /api/tasks — 创建任务（映射到创建会话）
  app.post('/api/tasks', async (request, reply) => {
    try {
      const body = request.body as { agentName?: string; title?: string; workspaceId?: string }
      const conversation = createConversation(body.agentName ?? 'default', body.title, body.workspaceId)
      return reply.status(201).send({ success: true, data: conversation })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to create task', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // DELETE /api/tasks/:id — 删除任务（映射到删除会话）
  app.delete('/api/tasks/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const deleted = deleteConversation(id)
      if (!deleted) {
        return reply.status(404).send({ success: false, error: 'Task not found' })
      }
      return reply.send({ success: true, data: { deleted: true } })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to delete task', message: error instanceof Error ? error.message : String(error) })
    }
  })
}
