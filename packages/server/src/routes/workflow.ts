import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function workflowRoutes(fastify: FastifyInstance) {
  // GET /api/workflow - 获取工作流列表
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: 从 core 包获取数据
      const workflows: any[] = [];
      return { success: true, data: { workflows } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // GET /api/workflow/:id - 获取单个工作流
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      // TODO: 从 core 包获取数据
      const workflow = { id, name: 'Mock Workflow' };
      return { success: true, data: { workflow } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
