/**
 * 授权请求管理器 - 管理运行时授权请求的 SSE 推送
 */

import { randomUUID } from 'node:crypto'

/**
 * 授权请求
 */
export interface ApprovalRequest {
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
 * SSE 连接
 */
interface SSEConnection {
  id: string
  response: any // Fastify Reply 对象
  createdAt: number
}

/**
 * 授权请求管理器（单例）
 */
class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>()
  private connections = new Map<string, SSEConnection>()

  /**
   * 创建授权请求
   * @param type 请求类型
   * @param requestedBy 请求来源
   * @param path 请求的路径（可选）
   * @param command 请求的命令（可选）
   * @returns 授权请求 ID
   */
  createRequest(
    type: 'read' | 'write' | 'shell',
    requestedBy: string,
    path?: string,
    command?: string
  ): string {
    const id = randomUUID()
    const request: ApprovalRequest = {
      id,
      type,
      path,
      command,
      requestedBy,
      status: 'pending',
      createdAt: Date.now(),
    }

    this.requests.set(id, request)

    // 通过 SSE 推送授权请求到所有连接的客户端
    this.broadcastRequest(request)

    return id
  }

  /**
   * 获取授权请求
   * @param id 请求 ID
   * @returns 授权请求
   */
  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id)
  }

  /**
   * 响应授权请求
   * @param id 请求 ID
   * @param action 响应动作（approve/deny）
   * @returns 是否成功
   */
  respondToRequest(id: string, action: 'approve' | 'deny'): boolean {
    const request = this.requests.get(id)

    if (!request) {
      return false
    }

    if (request.status !== 'pending') {
      return false
    }

    // 更新状态
    request.status = action === 'approve' ? 'approved' : 'denied'
    request.resolvedAt = Date.now()

    // 通过 SSE 推送响应结果到所有连接的客户端
    this.broadcastResponse(request)

    return true
  }

  /**
   * 等待授权请求被响应（Promise 版本）
   * @param id 请求 ID
   * @param timeout 超时时间（毫秒）
   * @returns 是否批准
   */
  async waitForResponse(id: string, timeout: number = 60000): Promise<boolean> {
    const startTime = Date.now()

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const request = this.requests.get(id)

        if (!request) {
          clearInterval(checkInterval)
          resolve(false)
          return
        }

        if (request.status !== 'pending') {
          clearInterval(checkInterval)
          resolve(request.status === 'approved')
          return
        }

        // 超时检查
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          resolve(false)
          return
        }
      }, 100)
    })
  }

  /**
   * 注册 SSE 连接
   * @param id 连接 ID
   * @param response Fastify Reply 对象
   */
  registerConnection(id: string, response: any): void {
    this.connections.set(id, {
      id,
      response,
      createdAt: Date.now(),
    })
  }

  /**
   * 取消注册 SSE 连接
   * @param id 连接 ID
   */
  unregisterConnection(id: string): void {
    const connection = this.connections.get(id)
    if (connection) {
      try {
        connection.response.raw.end()
      } catch {
        // 忽略错误
      }
      this.connections.delete(id)
    }
  }

  /**
   * 广播授权请求到所有 SSE 连接
   * @param request 授权请求
   */
  private broadcastRequest(request: ApprovalRequest): void {
    const event = {
      type: 'approval-request',
      request: {
        id: request.id,
        type: request.type,
        path: request.path,
        command: request.command,
        requestedBy: request.requestedBy,
        createdAt: request.createdAt,
      },
    }

    this.broadcast(event)
  }

  /**
   * 广播授权响应到所有 SSE 连接
   * @param request 授权请求
   */
  private broadcastResponse(request: ApprovalRequest): void {
    const event = {
      type: 'approval-response',
      request: {
        id: request.id,
        status: request.status,
        resolvedAt: request.resolvedAt,
      },
    }

    this.broadcast(event)
  }

  /**
   * 广播事件到所有 SSE 连接
   * @param event 事件对象
   */
  private broadcast(event: any): void {
    const data = `data: ${JSON.stringify(event)}\n\n`

    for (const connection of Array.from(this.connections.values())) {
      try {
        connection.response.raw.write(data)
      } catch {
        // 连接已断开，移除
        this.unregisterConnection(connection.id)
      }
    }
  }

  /**
   * 获取所有待处理的授权请求
   * @returns 待处理的授权请求列表
   */
  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (req) => req.status === 'pending'
    )
  }

  /**
   * 清理过期的授权请求（超过 5 分钟）
   */
  cleanup(): void {
    const now = Date.now()
    const timeout = 5 * 60 * 1000 // 5 分钟

    for (const [id, request] of Array.from(this.requests.entries())) {
      if (now - request.createdAt > timeout && request.status !== 'pending') {
        this.requests.delete(id)
      }
    }
  }
}

// 导出单例
export const approvalManager = new ApprovalManager()

// 定期清理过期请求（每 10 分钟）
setInterval(() => {
  approvalManager.cleanup()
}, 10 * 60 * 1000)
