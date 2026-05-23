/* 日志统计API路由 */

import { NextRequest, NextResponse } from 'next/server'
import { logManager } from '@/core/log'
import { LogFilter } from '@/core/log/types'

/** GET /api/logs/stats - 获取日志统计 */
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
    
    // 获取统计信息
    const stats = logManager.getStats(filter)
    
    return NextResponse.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error('Failed to get log stats:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get log stats',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}