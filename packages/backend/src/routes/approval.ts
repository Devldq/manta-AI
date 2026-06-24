/**
 * 运行时授权 API - 处理工具越权操作的授权请求
 */

import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'

/**
 * 授权请求状态
 */
interface ApprovalRequest {
  id: string
  type: 'read' | 'write' | 'shell'
  path?: string
  command?: string
  requestedBy: string  // taskId 或 workspaceId
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  resolvedAt?: number
}

/**
 * 内存中的授权请求存储（生产环境应使用 Redis 或数据库）
 */
const approvalRequests = new Map<string, ApprovalRequest>()

const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/approval/request - 创建授权请求
   */
  fastify.post('/api/approval/request', async (request, reply) => {
    const { type, path, command, requestedBy } = request.body as {
      type: 'read' | 'write' | 'shell'
      path?: string
      command?: string
      requestedBy: string
    }

    if (!type || !requestedBy) {
      return reply.status(400).send({
        success: false,
        error: '缺少必需字段：type 和 requestedBy',
      })
    }

    const id = randomUUID()
    const approvalRequest: ApprovalRequest = {
      id,
      type,
      path,
      command,
      requestedBy,
      status: 'pending',
      createdAt: Date.now(),
    }

    approvalRequests.set(id, approvalRequest)

    // TODO: 通过 SSE 推送授权请求到前端
    // 这里需要先获取 SSE 连接，然后推送消息
    // 暂时返回成功，前端需要通过轮询或 SSE 获取授权请求

    return {
      success: true,
      requestId: id,
      message: '授权请求已创建，等待用户响应',
    }
  })

  /**
   * GET /api/approval/:id - 查询授权请求状态
   */
  fastify.get('/api/approval/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const approvalRequest = approvalRequests.get(id)

    if (!approvalRequest) {
      return reply.status(404).send({
        success: false,
        error: '授权请求不存在',
      })
    }

    return {
      success: true,
      request: {
        id: approvalRequest.id,
        type: approvalRequest.type,
        path: approvalRequest.path,
        command: approvalRequest.command,
        requestedBy: approvalRequest.requestedBy,
        status: approvalRequest.status,
        createdAt: approvalRequest.createdAt,
        resolvedAt: approvalRequest.resolvedAt,
      },
    }
  })

  /**
   * POST /api/approval/:id/respond - 响应授权请求（允许/拒绝）
   */
  fastify.post('/api/approval/:id/respond', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { action } = request.body as { action: 'approve' | 'deny' }

    const approvalRequest = approvalRequests.get(id)

    if (!approvalRequest) {
      return reply.status(404).send({
        success: false,
        error: '授权请求不存在',
      })
    }

    if (approvalRequest.status !== 'pending') {
      return reply.status(400).send({
        success: false,
        error: '授权请求已处理，不能重复响应',
      })
    }

    // 更新状态
    approvalRequest.status = action === 'approve' ? 'approved' : 'denied'
    approvalRequest.resolvedAt = Date.now()

    // TODO: 通知等待中的工具继续执行或取消

    return {
      success: true,
      message: `授权请求已${action === 'approve' ? '批准' : '拒绝'}`,
      request: {
        id: approvalRequest.id,
        status: approvalRequest.status,
      },
    }
  })

  /**
   * GET /api/approval/pending - 获取所有待处理的授权请求
   */
  fastify.get('/api/approval/pending', async (request, reply) => {
    const pendingRequests = Array.from(approvalRequests.values())
      .filter((req) => req.status === 'pending')

    return {
      success: true,
      total: pendingRequests.length,
      requests: pendingRequests.map((req) => ({
        id: req.id,
        type: req.type,
        path: req.path,
        command: req.command,
        requestedBy: req.requestedBy,
        createdAt: req.createdAt,
      })),
    }
  })
}

export default approvalRoutes
