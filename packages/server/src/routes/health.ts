import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    return { status: 'ready', timestamp: new Date().toISOString() };
  });
}
