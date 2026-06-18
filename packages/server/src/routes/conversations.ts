import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { conversationService } from '@manta/core';

export async function conversationRoutes(fastify: FastifyInstance) {
  // GET /api/conversations - 获取会话列表
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { type, workspaceId } = request.query as { type?: string; workspaceId?: string };
      
      const conversations = conversationService.fetchConversations({
        type: (type as any) || 'single',
        workspaceId
      });
      
      return { success: true, data: { conversations } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/conversations - 创建新会话
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      const conversation = conversationService.createNewConversation({
        agentName: body.agentName || 'default',
        title: body.title,
        type: body.type || 'single',
        workspaceId: body.workspaceId
      });
      
      return { success: true, data: { conversation } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // GET /api/conversations/:id - 获取单个会话
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const conversation = conversationService.getConversationById(id);
      
      if (!conversation) {
        reply.status(404);
        return { success: false, error: 'Conversation not found' };
      }
      
      return { success: true, data: { conversation } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // DELETE /api/conversations/:id - 删除会话
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { type, workspaceId } = request.query as { type?: string; workspaceId?: string };
      
      const success = conversationService.deleteExistingConversation(id, type as any, workspaceId);
      
      if (!success) {
        reply.status(404);
        return { success: false, error: 'Conversation not found' };
      }
      
      return { success: true };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/conversations/:id/messages - 发送消息
  fastify.post('/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      
      const result = conversationService.addMessage(
        id,
        body.role || 'user',
        body.content,
        body.agentAppId
      );
      
      if (!result) {
        reply.status(404);
        return { success: false, error: 'Conversation not found' };
      }
      
      return { success: true, data: result };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
