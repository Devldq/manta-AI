/**
 * 运行时授权 API - 使用 ApprovalManager 作为唯一权威存储。
 */

import type { FastifyPluginAsync } from 'fastify'
import { approvalManager, type ApprovalRequest } from '../core/security/ApprovalManager'

const APPROVAL_TYPES = new Set<ApprovalRequest['type']>(['read', 'write', 'shell'])
const APPROVAL_ACTIONS = new Set(['approve', 'deny'])

function projectRequest(request: ApprovalRequest) {
  return {
    id: request.id,
    type: request.type,
    path: request.path,
    command: request.command,
    requestedBy: request.requestedBy,
    status: request.status,
    createdAt: request.createdAt,
    resolvedAt: request.resolvedAt,
  }
}

const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/approval/request', async (request, reply) => {
    const body = request.body as {
      type?: ApprovalRequest['type']
      path?: string
      command?: string
      requestedBy?: string
    }

    if (!body.type || !APPROVAL_TYPES.has(body.type) || !body.requestedBy?.trim()) {
      return reply.status(400).send({
        success: false,
        error: 'type 必须是 read、write 或 shell，且 requestedBy 不能为空',
      })
    }

    const requestId = approvalManager.createRequest(
      body.type,
      body.requestedBy.trim(),
      body.path,
      body.command,
    )

    return {
      success: true,
      requestId,
      message: '授权请求已创建，等待用户响应',
    }
  })

  fastify.get('/api/approval/pending', async () => {
    const requests = approvalManager.getPendingRequests().map(projectRequest)
    return { success: true, total: requests.length, requests }
  })

  fastify.get('/api/approval/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const approvalRequest = approvalManager.getRequest(id)

    if (!approvalRequest) {
      return reply.status(404).send({ success: false, error: '授权请求不存在' })
    }

    return { success: true, request: projectRequest(approvalRequest) }
  })

  fastify.post('/api/approval/:id/respond', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { action } = request.body as { action?: string }

    if (!action || !APPROVAL_ACTIONS.has(action)) {
      return reply.status(400).send({ success: false, error: 'action 必须是 approve 或 deny' })
    }

    const approvalRequest = approvalManager.getRequest(id)
    if (!approvalRequest) {
      return reply.status(404).send({ success: false, error: '授权请求不存在' })
    }
    if (approvalRequest.status !== 'pending') {
      return reply.status(409).send({ success: false, error: '授权请求已处理，不能重复响应' })
    }

    approvalManager.respondToRequest(id, action as 'approve' | 'deny')
    const resolvedRequest = approvalManager.getRequest(id)!
    return {
      success: true,
      message: `授权请求已${action === 'approve' ? '批准' : '拒绝'}`,
      request: projectRequest(resolvedRequest),
    }
  })
}

export default approvalRoutes
