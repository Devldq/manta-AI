/* 日志配置API路由 */

import { NextRequest, NextResponse } from 'next/server'
import { logManager } from '@/core/log'
import { LogReportConfig } from '@/core/log/types'

/** GET /api/logs/config - 获取日志配置 */
export async function GET() {
  try {
    const config = logManager.getConfig()
    
    return NextResponse.json({
      success: true,
      data: config,
    })
  } catch (error) {
    console.error('Failed to get log config:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get log config',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/** PUT /api/logs/config - 更新日志配置 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    
    // 验证配置
    const config: Partial<LogReportConfig> = {}
    
    if (body.enabled !== undefined) {
      config.enabled = Boolean(body.enabled)
    }
    
    if (body.level !== undefined) {
      const validLevels = ['debug', 'info', 'warn', 'error', 'fatal']
      if (!validLevels.includes(body.level)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid level',
            message: `Level must be one of: ${validLevels.join(', ')}`,
          },
          { status: 400 }
        )
      }
      config.level = body.level
    }
    
    if (body.batchSize !== undefined) {
      const batchSize = parseInt(body.batchSize)
      if (isNaN(batchSize) || batchSize < 1 || batchSize > 10000) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid batchSize',
            message: 'batchSize must be between 1 and 10000',
          },
          { status: 400 }
        )
      }
      config.batchSize = batchSize
    }
    
    if (body.reportInterval !== undefined) {
      const reportInterval = parseInt(body.reportInterval)
      if (isNaN(reportInterval) || reportInterval < 1000 || reportInterval > 300000) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid reportInterval',
            message: 'reportInterval must be between 1000 and 300000 milliseconds',
          },
          { status: 400 }
        )
      }
      config.reportInterval = reportInterval
    }
    
    if (body.maxCacheSize !== undefined) {
      const maxCacheSize = parseInt(body.maxCacheSize)
      if (isNaN(maxCacheSize) || maxCacheSize < 100 || maxCacheSize > 100000) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid maxCacheSize',
            message: 'maxCacheSize must be between 100 and 100000',
          },
          { status: 400 }
        )
      }
      config.maxCacheSize = maxCacheSize
    }
    
    if (body.endpoint !== undefined) {
      config.endpoint = body.endpoint
    }
    
    // 更新配置
    logManager.setConfig(config)
    
    // 返回更新后的配置
    const updatedConfig = logManager.getConfig()
    
    return NextResponse.json({
      success: true,
      data: updatedConfig,
      message: 'Log config updated successfully',
    })
  } catch (error) {
    console.error('Failed to update log config:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update log config',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/** POST /api/logs/config/reset - 重置日志配置 */
export async function POST(request: NextRequest) {
  try {
    const { pathname } = new URL(request.url)
    
    if (pathname.endsWith('/reset')) {
      // 重置为默认配置
      logManager.setConfig({
        enabled: true,
        level: 'debug' as any,
        batchSize: 100,
        reportInterval: 5000,
        maxCacheSize: 10000,
        endpoint: undefined,
        customReporter: undefined,
      })
      
      const config = logManager.getConfig()
      
      return NextResponse.json({
        success: true,
        data: config,
        message: 'Log config reset to defaults',
      })
    }
    
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid endpoint',
        message: 'Use PUT to update config or POST /reset to reset',
      },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to reset log config:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to reset log config',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}