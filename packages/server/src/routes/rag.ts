import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function ragRoutes(fastify: FastifyInstance) {
  // GET /api/rag/knowledge-bases - 获取知识库列表
  fastify.get('/knowledge-bases', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: 从 core 包获取数据
      const knowledgeBases: any[] = [];
      return { success: true, data: { knowledgeBases } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/rag/knowledge-bases - 创建知识库
  fastify.post('/knowledge-bases', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      // TODO: 调用 core 包创建知识库
      const knowledgeBase = { id: Date.now().toString(), ...body };
      return { success: true, data: { knowledgeBase } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
