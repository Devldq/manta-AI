/**
 * 授权请求 SSE 端点 - 推送授权请求到前端
 */

import { FastifyPluginAsync } from 'fastify'
import { approvalManager } from '../core/security/ApprovalManager'
import type { TaskRuntime } from '@manta/task-runtime'
import { hydrateDurableApprovals } from './durable-approvals.js'

export function createPendingApprovalSnapshot(runtime?: TaskRuntime) {
  hydrateDurableApprovals(runtime)
  return {
    type: 'approval-snapshot' as const,
    requests: approvalManager.getPendingRequests().map((request) => ({
      id: request.id,
      type: request.type,
      path: request.path,
      command: request.command,
      requestedBy: request.requestedBy,
      createdAt: request.createdAt,
    })),
  }
}

const approvalSSERoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/approval/sse - SSE 端点，用于接收授权请求
   */
  fastify.get('/api/approval/sse', async (request, reply) => {
    // 设置 SSE 头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    // 生成连接 ID
    const connectionId = `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 注册 SSE 连接
    approvalManager.registerConnection(connectionId, reply)

    // 发送初始连接成功消息
    const initEvent = {
      type: 'connected',
      connectionId,
      timestamp: Date.now(),
    }
    reply.raw.write(`data: ${JSON.stringify(initEvent)}\n\n`)

    // 每次连接（含浏览器自动重连）都发送权威快照，用于清除本地已失效请求。
    reply.raw.write(`data: ${JSON.stringify(createPendingApprovalSnapshot(fastify.taskRuntime))}\n\n`)

    // 保持连接打开，直到客户端断开
    request.raw.on('close', () => {
      approvalManager.unregisterConnection(connectionId)
    })

    // 防止连接超时
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(':keep-alive\n\n')
      } catch {
        clearInterval(keepAlive)
        approvalManager.unregisterConnection(connectionId)
      }
    }, 30000) // 每 30 秒发送一次心跳

    request.raw.on('close', () => {
      clearInterval(keepAlive)
    })
  })
}

export default approvalSSERoutes
