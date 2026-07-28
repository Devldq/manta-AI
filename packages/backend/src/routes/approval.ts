/**
 * 运行时授权 API - 使用 ApprovalManager 作为唯一权威存储。
 */

import type { FastifyPluginAsync } from 'fastify'
import { approvalManager, type ApprovalRequest } from '../core/security/ApprovalManager'
import {
  expirePendingApprovals,
  hydrateDurableApprovals,
  provideDurableApprovalInput,
} from './durable-approvals.js'
import {
  getApprovalPolicy,
  getApprovalTimeoutAction,
  isApprovalMode,
  isApprovalTimeoutMs,
  saveApprovalPolicy,
} from '../core/security/approval-policy.js'

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
    expiresAt: request.expiresAt,
    timeoutAction: request.timeoutAction,
    resolvedAt: request.resolvedAt,
  }
}

const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  const reconcileTimer = setInterval(() => {
    hydrateDurableApprovals(fastify.taskRuntime)
    expirePendingApprovals(fastify.taskRuntime)
  }, 500)
  reconcileTimer.unref()
  fastify.addHook('onClose', (_instance, done) => {
    clearInterval(reconcileTimer)
    done()
  })

  fastify.get('/api/approval/policy', async () => {
    const policy = getApprovalPolicy()
    return {
      success: true,
      policy: {
        ...policy,
        timeoutAction: getApprovalTimeoutAction(policy.mode),
      },
    }
  })

  fastify.put('/api/approval/policy', async (request, reply) => {
    const body = request.body as {
      mode?: unknown
      timeoutMs?: unknown
      confirmFullAccess?: boolean
    }
    const currentPolicy = getApprovalPolicy()
    if (!isApprovalMode(body.mode)) {
      return reply.status(400).send({
        success: false,
        error: 'mode 必须是 request、auto 或 full',
      })
    }
    if (body.mode === 'full' && currentPolicy.mode !== 'full' && body.confirmFullAccess !== true) {
      return reply.status(400).send({
        success: false,
        code: 'FULL_ACCESS_CONFIRMATION_REQUIRED',
        error: '启用完全访问前必须明确确认风险',
      })
    }
    const timeoutMs = body.timeoutMs ?? currentPolicy.timeoutMs
    if (!isApprovalTimeoutMs(timeoutMs)) {
      return reply.status(400).send({
        success: false,
        error: 'timeoutMs 必须是 5000 到 600000 之间的整数',
      })
    }
    const policy = saveApprovalPolicy({
      mode: body.mode,
      timeoutMs,
    })
    return {
      success: true,
      policy: {
        ...policy,
        timeoutAction: getApprovalTimeoutAction(policy.mode),
      },
    }
  })

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

    const policy = getApprovalPolicy()
    const requestId = approvalManager.createRequest(
      body.type,
      body.requestedBy.trim(),
      body.path,
      body.command,
      undefined,
      policy.timeoutMs,
    )

    return {
      success: true,
      requestId,
      message: '授权请求已创建，等待用户响应',
    }
  })

  fastify.get('/api/approval/pending', async () => {
    hydrateDurableApprovals(fastify.taskRuntime)
    expirePendingApprovals(fastify.taskRuntime)
    const requests = approvalManager.getPendingRequests().map(projectRequest)
    return { success: true, total: requests.length, requests }
  })

  fastify.get('/api/approval/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    hydrateDurableApprovals(fastify.taskRuntime)
    expirePendingApprovals(fastify.taskRuntime)
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

    hydrateDurableApprovals(fastify.taskRuntime)
    expirePendingApprovals(fastify.taskRuntime)
    const approvalRequest = approvalManager.getRequest(id)
    if (!approvalRequest) {
      // Decisions are idempotent. A delayed renderer may submit after the
      // request was already removed during restart/cleanup.
      return {
        success: true,
        stale: true,
        message: '授权请求已失效，无需再次响应',
      }
    }
    if (approvalRequest.status !== 'pending') {
      return {
        success: true,
        stale: true,
        message: '授权请求已处理，无需再次响应',
        request: projectRequest(approvalRequest),
      }
    }

    const decision = action as 'approve' | 'deny'
    if (approvalRequest.durable && !provideDurableApprovalInput(fastify.taskRuntime, approvalRequest, decision)) {
      approvalManager.respondToRequest(id, 'deny')
      return {
        success: true,
        stale: true,
        message: '授权请求已失效，无需再次响应',
        request: projectRequest(approvalManager.getRequest(id)!),
      }
    }
    if (!approvalRequest.durable) provideDurableApprovalInput(fastify.taskRuntime, approvalRequest, decision)
    approvalManager.respondToRequest(id, decision)
    const resolvedRequest = approvalManager.getRequest(id)!
    return {
      success: true,
      message: `授权请求已${action === 'approve' ? '批准' : '拒绝'}`,
      request: projectRequest(resolvedRequest),
    }
  })
}

export default approvalRoutes
