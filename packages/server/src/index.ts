import Fastify from 'fastify';
import cors from '@fastify/cors';
import { conversationRoutes } from './routes/conversations';
import { chatRoutes } from './routes/chat';
import { mcpRoutes } from './routes/mcp';
import { appRoutes } from './routes/apps';
import { workspaceRoutes } from './routes/workspaces';
import { workflowRoutes } from './routes/workflow';
import { logRoutes } from './routes/logs';
import { ragRoutes } from './routes/rag';
import { healthRoutes } from './routes/health';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } }
        : undefined
    }
  });

  // 注册 CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  });

  // 注册路由
  await fastify.register(healthRoutes, { prefix: '/api/health' });
  await fastify.register(conversationRoutes, { prefix: '/api/conversations' });
  await fastify.register(chatRoutes, { prefix: '/api/chat' });
  await fastify.register(mcpRoutes, { prefix: '/api/mcp' });
  await fastify.register(appRoutes, { prefix: '/api/apps' });
  await fastify.register(workspaceRoutes, { prefix: '/api/workspaces' });
  await fastify.register(workflowRoutes, { prefix: '/api/workflow' });
  await fastify.register(logRoutes, { prefix: '/api/logs' });
  await fastify.register(ragRoutes, { prefix: '/api/rag' });

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();
    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 Manta Server running at http://${HOST}:${PORT}`);
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
