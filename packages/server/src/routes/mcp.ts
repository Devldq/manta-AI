import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function mcpRoutes(fastify: FastifyInstance) {
  // GET /api/mcp/servers - 获取 MCP 服务器列表
  fastify.get('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: 从 core 包获取数据
      const servers: any[] = [];
      return { success: true, data: { servers } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/mcp/servers - 添加 MCP 服务器
  fastify.post('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      // TODO: 调用 core 包添加服务器
      const server = { id: Date.now().toString(), ...body };
      return { success: true, data: { server } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // GET /api/mcp/status - 获取 MCP 状态
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: 从 core 包获取数据
      const status = { connected: 0, total: 0 };
      return { success: true, data: status };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
