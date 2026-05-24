/* 日志实时流API路由 */

import { NextRequest } from 'next/server'
import { logManager } from '@/core/log'
import { LogEntry, LogFilter } from '@/core/log/types'

/** GET /api/logs/stream - 实时日志流 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  
  // 解析过滤参数
  const filter: LogFilter = {}
  
  // 级别过滤
  const level = searchParams.get('level')
  if (level) {
    filter.level = level.split(',') as any[]
  }
  
  // 类型过滤
  const type = searchParams.get('type')
  if (type) {
    filter.type = type.split(',') as any[]
  }
  
  // 来源过滤
  const source = searchParams.get('source')
  if (source) {
    filter.source = source.split(',') as any[]
  }
  
  // 会话ID
  const conversationId = searchParams.get('conversationId')
  if (conversationId) {
    filter.conversationId = conversationId
  }
  
  // 创建SSE响应
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接消息
      const initialLogs = logManager.getLogs(filter)
      const initMessage = {
        type: 'connected',
        timestamp: new Date().toISOString(),
        message: 'Log stream connected',
        logCount: initialLogs.length,
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initMessage)}\n\n`))

      // 记录已发送的日志 ID 集合
      const sentIds = new Set<string>()

      // 初始发送当前所有日志
      initialLogs.forEach((log: LogEntry) => {
        sentIds.add(log.id)
        const message = { type: 'log', data: log }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      })

      // 定期检查新日志
      const interval = setInterval(() => {
        try {
          const currentLogs = logManager.getLogs(filter)
          const newLogs = currentLogs.filter((log: LogEntry) => !sentIds.has(log.id))

          if (newLogs.length > 0) {
            newLogs.forEach((log: LogEntry) => {
              sentIds.add(log.id)
              const message = { type: 'log', data: log }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
            })
          }
          
          // 发送心跳（仅包含计数，不触发客户端全量刷新）
          const heartbeat = {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            logCount: currentLogs.length,
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(heartbeat)}\n\n`))
          
        } catch (error) {
          console.error('Error in log stream:', error)
          const errorMessage = {
            type: 'error',
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorMessage)}\n\n`))
        }
      }, 1000) // 每秒检查一次
      
      // 清理函数
      const cleanup = () => {
        clearInterval(interval)
        try {
          controller.close()
        } catch {
          // 忽略关闭错误
        }
      }
      
      // 监听连接关闭
      request.signal.addEventListener('abort', cleanup)
      
      // 设置超时自动关闭（5分钟）
      setTimeout(cleanup, 5 * 60 * 1000)
    },
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用nginx缓冲
    },
  })
}