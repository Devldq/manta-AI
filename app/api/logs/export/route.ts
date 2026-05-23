/* 日志导出API路由 */

import { NextRequest, NextResponse } from 'next/server'
import { logManager } from '@/core/log'
import { LogExportOptions, LogExportFormat } from '@/core/log/types'

/** POST /api/logs/export - 导出日志 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // 验证请求体
    if (!body.format) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          message: 'format is required',
        },
        { status: 400 }
      )
    }
    
    // 验证格式
    const validFormats: LogExportFormat[] = ['json', 'csv', 'text', 'html']
    if (!validFormats.includes(body.format)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid format',
          message: `Format must be one of: ${validFormats.join(', ')}`,
        },
        { status: 400 }
      )
    }
    
    // 构建导出选项
    const options: LogExportOptions = {
      format: body.format,
      filter: body.filter,
      includeMetadata: body.includeMetadata ?? true,
      includeDetails: body.includeDetails ?? true,
      compression: body.compression ?? 'none',
    }
    
    // 导出日志
    const result = await logManager.exportLogs(options)
    
    // 根据格式返回不同的响应
    if (body.format === 'json' || body.format === 'text') {
      // 返回文本内容
      return new NextResponse(result.data as string, {
        headers: {
          'Content-Type': body.format === 'json' ? 'application/json' : 'text/plain',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'X-Log-Count': String(result.count),
          'X-Log-Size': String(result.size),
        },
      })
    } else if (body.format === 'csv') {
      // 返回CSV内容
      return new NextResponse(result.data as string, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'X-Log-Count': String(result.count),
          'X-Log-Size': String(result.size),
        },
      })
    } else if (body.format === 'html') {
      // 返回HTML内容
      return new NextResponse(result.data as string, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'X-Log-Count': String(result.count),
          'X-Log-Size': String(result.size),
        },
      })
    } else {
      // 返回Blob
      return new NextResponse(result.data as Blob, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'X-Log-Count': String(result.count),
          'X-Log-Size': String(result.size),
        },
      })
    }
  } catch (error) {
    console.error('Failed to export logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to export logs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}