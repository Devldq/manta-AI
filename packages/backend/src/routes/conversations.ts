import type { FastifyInstance } from 'fastify'
import { fetchConversations, createNewConversation } from '../core/services/conversation.service'
import type { ConversationType } from '../core/types'
import { apiSuccess, apiError } from '../core/api/error-handler'

export async function conversationRoutes(app: FastifyInstance) {
  // GET /api/conversations — 获取会话列表
  app.get('/api/conversations', async (request, reply) => {
    try {
      const { type, workspaceId } = request.query as {
        type?: string
        workspaceId?: string
      }
      const convType = (type as ConversationType) || 'global'
      const conversations = fetchConversations({ type: convType, workspaceId })
      return reply.send(apiSuccess({ conversations }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/conversations — 创建新会话
  app.post('/api/conversations', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const conversation = createNewConversation({
        ...body,
        type: (body.type as ConversationType) || 'global',
      } as Parameters<typeof createNewConversation>[0])
      return reply.status(201).send(apiSuccess({ conversation }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
