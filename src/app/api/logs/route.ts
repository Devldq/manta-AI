/* 日志API路由 */

import { NextRequest, NextResponse } from 'next/server'
import { logManager } from '@observability/log'
import { LogFilter, LogExportOptions } from '@observability/log/types'

/** GET /api/logs - 获取日志 */
export async function GET(request: NextRequest) {
  try {
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
    
    // 搜索关键词
    const search = searchParams.get('search')
    if (search) {
      filter.search = search
    }
    
    // 时间范围
    const startTime = searchParams.get('startTime')
    const endTime = searchParams.get('endTime')
    if (startTime && endTime) {
      filter.timeRange = {
        start: startTime,
        end: endTime,
      }
    }
    
    // 会话ID
    const conversationId = searchParams.get('conversationId')
    if (conversationId) {
      filter.conversationId = conversationId
    }
    
    // 消息ID
    const messageId = searchParams.get('messageId')
    if (messageId) {
      filter.messageId = messageId
    }
    
    // 工具名称
    const toolName = searchParams.get('toolName')
    if (toolName) {
      filter.toolName = toolName
    }
    
    // 错误过滤
    const isError = searchParams.get('isError')
    if (isError !== null) {
      filter.isError = isError === 'true'
    }
    
    // 分页
    const page = searchParams.get('page')
    const pageSize = searchParams.get('pageSize')
    if (page && pageSize) {
      filter.pagination = {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      }
    }
    
    // 获取日志
    const logs = logManager.getLogs(filter)
    
    // 获取统计信息
    const stats = logManager.getStats(filter)
    
    return NextResponse.json({
      success: true,
      data: {
        logs,
        stats,
        total: logs.length,
        filter,
      },
    })
  } catch (error) {
    console.error('Failed to get logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/** POST /api/logs - 添加日志 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // 验证请求体
    if (!body.logs || !Array.isArray(body.logs)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          message: 'logs array is required',
        },
        { status: 400 }
      )
    }
    
    // 添加日志
    logManager.addLogs(body.logs)
    
    return NextResponse.json({
      success: true,
      data: {
        added: body.logs.length,
      },
    })
  } catch (error) {
    console.error('Failed to add logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/** DELETE /api/logs - 清空日志 */
export async function DELETE(request: NextRequest) {
  try {
    logManager.clearLogs()
    
    return NextResponse.json({
      success: true,
      data: {
        cleared: true,
      },
    })
  } catch (error) {
    console.error('Failed to clear logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to clear logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}