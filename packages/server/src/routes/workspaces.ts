import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { workspaceService } from '@manta/core';

export async function workspaceRoutes(fastify: FastifyInstance) {
  // GET /api/workspaces - 获取工作空间列表
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const workspaces = workspaceService.fetchWorkspaces();
      
      return { success: true, data: { workspaces } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // POST /api/workspaces - 创建新工作空间
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      const workspace = workspaceService.createNewWorkspace(body);
      
      return { success: true, data: { workspace } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // GET /api/workspaces/:id - 获取单个工作空间
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const workspace = workspaceService.getWorkspaceById(id);
      
      if (!workspace) {
        reply.status(404);
        return { success: false, error: 'Workspace not found' };
      }
      
      return { success: true, data: { workspace } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // PUT /api/workspaces/:id - 更新工作空间
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      
      const workspace = workspaceService.updateExistingWorkspace(id, body);
      
      if (!workspace) {
        reply.status(404);
        return { success: false, error: 'Workspace not found' };
      }
      
      return { success: true, data: { workspace } };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });

  // DELETE /api/workspaces/:id - 删除工作空间
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const success = workspaceService.deleteExistingWorkspace(id);
      
      if (!success) {
        reply.status(404);
        return { success: false, error: 'Workspace not found' };
      }
      
      return { success: true };
    } catch (err: any) {
      reply.status(500);
      return { success: false, error: err.message };
    }
  });
}
