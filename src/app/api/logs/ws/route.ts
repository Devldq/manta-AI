/* 日志WebSocket API路由 */

import { NextRequest } from 'next/server'
import { logManager } from '@observability/log'
import { LogEntry, LogFilter } from '@observability/log/types'

/** WebSocket日志连接管理器 */
class LogWebSocketManager {
  private static instance: LogWebSocketManager | null = null
  private connections: Map<string, WebSocket> = new Map()
  private filters: Map<string, LogFilter> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()

  private constructor() {}

  static getInstance(): LogWebSocketManager {
    if (!LogWebSocketManager.instance) {
      LogWebSocketManager.instance = new LogWebSocketManager()
    }
    return LogWebSocketManager.instance
  }

  /** 添加连接 */
  addConnection(id: string, ws: WebSocket, filter?: LogFilter): void {
    this.connections.set(id, ws)
    if (filter) {
      this.filters.set(id, filter)
    }

    // 发送初始连接消息
    this.sendMessage(id, {
      type: 'connected',
      timestamp: new Date().toISOString(),
      message: 'Log WebSocket connected',
      connectionId: id,
    })

    // 开始定期发送日志
    this.startLogStream(id)

    // 监听关闭
    ws.addEventListener('close', () => {
      this.removeConnection(id)
    })

    ws.addEventListener('error', () => {
      this.removeConnection(id)
    })
  }

  /** 移除连接 */
  removeConnection(id: string): void {
    this.connections.delete(id)
    this.filters.delete(id)
    
    const interval = this.intervals.get(id)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(id)
    }
  }

  /** 发送消息 */
  private sendMessage(id: string, message: any): void {
    const ws = this.connections.get(id)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message))
      } catch (error) {
        console.error(`Failed to send message to ${id}:`, error)
        this.removeConnection(id)
      }
    }
  }

  /** 开始日志流 */
  private startLogStream(id: string): void {
    let lastLogCount = 0

    const interval = setInterval(() => {
      try {
        const filter = this.filters.get(id)
        const currentLogs = logManager.getLogs(filter)
        const currentCount = currentLogs.length

        if (currentCount > lastLogCount) {
          // 有新日志
          const newLogs = currentLogs.slice(0, currentCount - lastLogCount)
          
          // 批量发送新日志
          if (newLogs.length > 0) {
            this.sendMessage(id, {
              type: 'logs',
              data: newLogs,
              count: newLogs.length,
              timestamp: new Date().toISOString(),
            })
          }

          lastLogCount = currentCount
        }

        // 发送心跳
        this.sendMessage(id, {
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          logCount: currentCount,
          connectionId: id,
        })

      } catch (error) {
        console.error(`Error in log stream for ${id}:`, error)
        this.sendMessage(id, {
          type: 'error',
          timestamp: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }, 1000) // 每秒检查一次

    this.intervals.set(id, interval)
  }

  /** 获取连接数 */
  getConnectionCount(): number {
    return this.connections.size
  }

  /** 获取连接信息 */
  getConnectionInfo(): Array<{ id: string; filter?: LogFilter }> {
    const info: Array<{ id: string; filter?: LogFilter }> = []
    
    this.connections.forEach((_, id) => {
      info.push({
        id,
        filter: this.filters.get(id),
      })
    })
    
    return info
  }

  /** 广播消息到所有连接 */
  broadcast(message: any): void {
    this.connections.forEach((ws, id) => {
      this.sendMessage(id, message)
    })
  }
}

/** WebSocket升级处理 */
export async function GET(request: NextRequest) {
  // 检查是否为WebSocket升级请求
  const upgrade = request.headers.get('upgrade')
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 400 })
  }

  // 获取WebSocket
  const { socket, response } = (globalThis as any).WebSocketPair
    ? new (globalThis as any).WebSocketPair()
    : { socket: null, response: null }

  if (!socket || !response) {
    return new Response('WebSocket not supported', { status: 500 })
  }

  // 生成连接ID
  const connectionId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // 解析过滤参数
  const { searchParams } = new URL(request.url)
  const filter: LogFilter = {}

  const level = searchParams.get('level')
  if (level) {
    filter.level = level.split(',') as any[]
  }

  const type = searchParams.get('type')
  if (type) {
    filter.type = type.split(',') as any[]
  }

  const source = searchParams.get('source')
  if (source) {
    filter.source = source.split(',') as any[]
  }

  const conversationId = searchParams.get('conversationId')
  if (conversationId) {
    filter.conversationId = conversationId
  }

  // 添加到管理器
  const wsManager = LogWebSocketManager.getInstance()
  wsManager.addConnection(connectionId, socket, filter)

  // 返回WebSocket响应
  return response
}

/** 获取WebSocket连接信息 */
export async function POST(request: NextRequest) {
  try {
    const wsManager = LogWebSocketManager.getInstance()
    
    const info = {
      connectionCount: wsManager.getConnectionCount(),
      connections: wsManager.getConnectionInfo(),
      timestamp: new Date().toISOString(),
    }
    
    return Response.json({
      success: true,
      data: info,
    })
  } catch (error) {
    console.error('Failed to get WebSocket info:', error)
    return Response.json(
      {
        success: false,
        error: 'Failed to get WebSocket info',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}