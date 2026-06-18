import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { appService } from '@manta/core';

export async function appRoutes(fastify: FastifyInstance) {
  // GET /api/apps - 获取应用列表
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sort } = request.query as { sort?: string };
      
      const apps = appService.fetchApps({ sort });
      
      return { success: true, data: { apps } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/apps - 创建新应用
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      const app = appService.createNewApp(body);
      
      return { success: true, data: { app } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // GET /api/apps/:id - 获取单个应用
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const app = appService.getAppById(id);
      
      if (!app) {
        reply.status(404);
        return { success: false, error: 'App not found' };
      }
      
      return { success: true, data: { app } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // PUT /api/apps/:id - 更新应用
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      
      const app = appService.updateExistingApp(id, body);
      
      if (!app) {
        reply.status(404);
        return { success: false, error: 'App not found' };
      }
      
      return { success: true, data: { app } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // DELETE /api/apps/:id - 删除应用
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const success = appService.deleteExistingApp(id);
      
      if (!success) {
        reply.status(404);
        return { success: false, error: 'App not found' };
      }
      
      return { success: true };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
