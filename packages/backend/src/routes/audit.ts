/**
 * 审计日志查询 API
 */

import { FastifyPluginAsync } from 'fastify'
import { currentDiagnosticsOwner } from '../storage/runtime-diagnostics'

// ─── 从 @manta/agent-sandbox 复制的审计日志函数 ──────────────────────

function diagnostics() {
  const owner = currentDiagnosticsOwner()
  if (!owner) throw new Error('Diagnostics writer is not available')
  return owner
}

interface AuditEntry {
  timestamp: string
  taskId?: string
  workspaceId?: string
  action: string
  path?: string
  command?: string
  approved?: boolean
  durationMs?: number
}

function readAuditLogs(options?: {
  taskId?: string
  workspaceId?: string
  action?: string
  startTime?: string
  endTime?: string
  limit?: number
}): AuditEntry[] {
  let entries = diagnostics().readAuditEntries<AuditEntry & Record<string, unknown>>()
  
  // 应用过滤条件
  if (options?.taskId) {
    entries = entries.filter((e) => e.taskId === options.taskId)
  }
  if (options?.workspaceId) {
    entries = entries.filter((e) => e.workspaceId === options.workspaceId)
  }
  if (options?.action) {
    entries = entries.filter((e) => e.action === options.action)
  }
  if (options?.startTime) {
    entries = entries.filter((e) => e.timestamp >= options.startTime!)
  }
  if (options?.endTime) {
    entries = entries.filter((e) => e.timestamp <= options.endTime!)
  }
  
  // 应用限制
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(-options.limit)
  }
  
  return entries
}

function clearAuditLogs(): void {
  diagnostics().clearAudit()
}

function getAuditLogSize(): number {
  return diagnostics().auditSize()
}

// ─── 路由定义 ──────────────────────────────────────────────────────────

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/audit/logs - 查询审计日志
   * 
   * 查询参数：
   * - taskId: 按任务 ID 筛选
   * - workspaceId: 按工作空间 ID 筛选
   * - action: 按操作动作筛选
   * - startTime: 开始时间（ISO 8601 格式）
   * - endTime: 结束时间（ISO 8601 格式）
   * - limit: 限制返回条数
   */
  fastify.get('/api/audit/logs', async (request, reply) => {
    const {
      taskId,
      workspaceId,
      action,
      startTime,
      endTime,
      limit,
    } = request.query as {
      taskId?: string
      workspaceId?: string
      action?: string
      startTime?: string
      endTime?: string
      limit?: string
    }

    const logs = readAuditLogs({
      taskId,
      workspaceId,
      action,
      startTime,
      endTime,
      limit: limit ? parseInt(limit, 10) : undefined,
    })

    return {
      success: true,
      total: logs.length,
      logs,
    }
  })

  /**
   * GET /api/audit/stats - 获取审计日志统计信息
   */
  fastify.get('/api/audit/stats', async (request, reply) => {
    const logs = readAuditLogs()
    const size = getAuditLogSize()

    // 统计信息
    const stats = {
      total: logs.length,
      sizeBytes: size,
      sizeMB: (size / (1024 * 1024)).toFixed(2),
      actions: {} as Record<string, number>,
      approved: 0,
      rejected: 0,
    }

    // 统计各动作的频次
    for (const log of logs) {
      stats.actions[log.action] = (stats.actions[log.action] || 0) + 1
      if (log.approved) {
        stats.approved++
      } else {
        stats.rejected++
      }
    }

    return {
      success: true,
      stats,
    }
  })

  /**
   * DELETE /api/audit/logs - 清除审计日志
   */
  fastify.delete('/api/audit/logs', async (request, reply) => {
    try {
      clearAuditLogs()
      
      return {
        success: true,
        message: '审计日志已清除',
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : '清除审计日志失败',
      })
    }
  })
}

export default auditRoutes
