/* 日志上报API路由 */

import { NextRequest, NextResponse } from 'next/server'
import { logManager } from '@/core/log'
import { LogEntry } from '@/core/log/types'

/** POST /api/logs/report - 上报日志 */
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
    
    // 验证日志格式
    const validLogs: Omit<LogEntry, 'id' | 'timestamp'>[] = []
    const invalidLogs: any[] = []
    
    body.logs.forEach((log: any, index: number) => {
      if (isValidLogEntry(log)) {
        validLogs.push(log)
      } else {
        invalidLogs.push({ index, log })
      }
    })
    
    // 添加有效日志
    if (validLogs.length > 0) {
      logManager.addLogs(validLogs)
    }
    
    // 返回结果
    const response: any = {
      success: true,
      data: {
        received: body.logs.length,
        added: validLogs.length,
        invalid: invalidLogs.length,
      },
    }
    
    // 如果有无效日志，返回详细信息
    if (invalidLogs.length > 0) {
      response.data.invalidLogs = invalidLogs.slice(0, 10) // 最多返回10条
      response.message = `Added ${validLogs.length} logs, ${invalidLogs.length} invalid`
    } else {
      response.message = `Added ${validLogs.length} logs`
    }
    
    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to report logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to report logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/** 验证日志条目是否有效 */
function isValidLogEntry(log: any): log is Omit<LogEntry, 'id' | 'timestamp'> {
  // 检查必需字段
  if (!log || typeof log !== 'object') {
    return false
  }
  
  // 检查level
  const validLevels = ['debug', 'info', 'warn', 'error', 'fatal']
  if (!log.level || !validLevels.includes(log.level)) {
    return false
  }
  
  // 检查type
  const validTypes = [
    'tool_call', 'system', 'agent_loop', 'workflow',
    'user_action', 'performance', 'error', 'security'
  ]
  if (!log.type || !validTypes.includes(log.type)) {
    return false
  }
  
  // 检查source
  const validSources = ['client', 'server', 'agent', 'tool', 'system']
  if (!log.source || !validSources.includes(log.source)) {
    return false
  }
  
  // 检查message
  if (!log.message || typeof log.message !== 'string') {
    return false
  }
  
  return true
}

/** PUT /api/logs/report - 批量上报日志（支持压缩） */
export async function PUT(request: NextRequest) {
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
    
    // 检查是否压缩
    const isCompressed = body.compressed === true
    
    let logs: any[]
    
    if (isCompressed) {
      // 解压日志（这里简化处理，实际应该支持gzip等压缩）
      try {
        logs = JSON.parse(body.logs)
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to decompress logs',
            message: 'Invalid compressed data',
          },
          { status: 400 }
        )
      }
    } else {
      logs = body.logs
    }
    
    // 验证并添加日志
    const validLogs: Omit<LogEntry, 'id' | 'timestamp'>[] = []
    const invalidCount = 0
    
    logs.forEach((log: any) => {
      if (isValidLogEntry(log)) {
        validLogs.push(log)
      }
    })
    
    if (validLogs.length > 0) {
      logManager.addLogs(validLogs)
    }
    
    return NextResponse.json({
      success: true,
      data: {
        received: logs.length,
        added: validLogs.length,
        invalid: logs.length - validLogs.length,
        compressed: isCompressed,
      },
      message: `Added ${validLogs.length} logs`,
    })
  } catch (error) {
    console.error('Failed to report logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to report logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}