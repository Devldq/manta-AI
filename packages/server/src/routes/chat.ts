import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function chatRoutes(fastify: FastifyInstance) {
  // POST /api/chat/stream - SSE 流式聊天
  fastify.post('/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');

      // TODO: 调用 core 包的 Agent Loop
      // 暂时返回模拟数据
      const mockResponse = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'This is a mock response. Please implement the actual Agent Loop.',
        timestamp: new Date().toISOString()
      };
      
      reply.raw.write(`data: ${JSON.stringify(mockResponse)}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      reply.raw.end();
    }
  });

  // POST /api/chat/config - 获取聊天配置
  fastify.post('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // TODO: 从 core 包获取配置
      const config = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096
      };
      
      return { success: true, data: config };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
