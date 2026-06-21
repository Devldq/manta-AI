import type { FastifyInstance } from 'fastify'
import { logManager, LogManager } from '../core/observability/log'
import type { LogFilter, LogExportOptions, LogExportFormat, LogEntry } from '../core/observability/log/types'
import * as fs from 'fs'

export async function logRoutes(app: FastifyInstance) {
  // ─── Logs CRUD ───────────────────────────────────────────────

  // GET /api/logs — 获取日志
  app.get('/api/logs', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>
      const filter: LogFilter = {}

      if (q.level) filter.level = q.level.split(',') as any[]
      if (q.type) filter.type = q.type.split(',') as any[]
      if (q.source) filter.source = q.source.split(',') as any[]
      if (q.search) filter.search = q.search
      if (q.startTime && q.endTime) filter.timeRange = { start: q.startTime, end: q.endTime }
      if (q.conversationId) filter.conversationId = q.conversationId
      if (q.messageId) filter.messageId = q.messageId
      if (q.toolName) filter.toolName = q.toolName
      if (q.isError !== undefined) filter.isError = q.isError === 'true'
      if (q.page && q.pageSize) filter.pagination = { page: parseInt(q.page), pageSize: parseInt(q.pageSize) }

      const logs = logManager.getLogs(filter)
      const stats = logManager.getStats(filter)
      return reply.send({ success: true, data: { logs, stats, total: logs.length, filter } })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to get logs', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // POST /api/logs — 添加日志
  app.post('/api/logs', async (request, reply) => {
    try {
      const body = request.body as { logs?: any[] }
      if (!body.logs || !Array.isArray(body.logs)) {
        return reply.status(400).send({ success: false, error: 'Invalid request body', message: 'logs array is required' })
      }
      logManager.addLogs(body.logs)
      return reply.send({ success: true, data: { added: body.logs.length } })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to add logs', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // DELETE /api/logs — 清空日志
  app.delete('/api/logs', async (_request, reply) => {
    try {
      logManager.clearLogs()
      return reply.send({ success: true, data: { cleared: true } })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to clear logs', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // ─── Log Stats ───────────────────────────────────────────────

  // GET /api/logs/stats — 日志统计
  app.get('/api/logs/stats', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>
      const filter: LogFilter = {}
      if (q.level) filter.level = q.level.split(',') as any[]
      if (q.type) filter.type = q.type.split(',') as any[]
      if (q.source) filter.source = q.source.split(',') as any[]
      if (q.startTime && q.endTime) filter.timeRange = { start: q.startTime, end: q.endTime }
      if (q.conversationId) filter.conversationId = q.conversationId

      const stats = logManager.getStats(filter)
      return reply.send({ success: true, data: stats })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to get log stats', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // ─── Log Config ──────────────────────────────────────────────

  // GET /api/logs/config — 获取日志配置
  app.get('/api/logs/config', async (_request, reply) => {
    try {
      const config = logManager.getConfig()
      return reply.send({ success: true, data: config })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to get log config', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // PUT /api/logs/config — 更新日志配置
  app.put('/api/logs/config', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const config: Record<string, unknown> = {}
      if (body.enabled !== undefined) config.enabled = Boolean(body.enabled)
      if (body.level !== undefined) {
        const validLevels = ['debug', 'info', 'warn', 'error', 'fatal']
        if (!validLevels.includes(body.level as string)) return reply.status(400).send({ success: false, error: 'Invalid level' })
        config.level = body.level
      }
      if (body.batchSize !== undefined) config.batchSize = parseInt(body.batchSize as string)
      if (body.reportInterval !== undefined) config.reportInterval = parseInt(body.reportInterval as string)
      if (body.maxCacheSize !== undefined) config.maxCacheSize = parseInt(body.maxCacheSize as string)
      if (body.endpoint !== undefined) config.endpoint = body.endpoint

      logManager.setConfig(config as any)
      const updatedConfig = logManager.getConfig()
      return reply.send({ success: true, data: updatedConfig, message: 'Log config updated successfully' })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to update log config', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // POST /api/logs/config/reset — 重置日志配置
  app.post('/api/logs/config/reset', async (_request, reply) => {
    try {
      logManager.setConfig({ enabled: true, level: 'debug' as any, batchSize: 100, reportInterval: 5000, maxCacheSize: 10000 })
      const config = logManager.getConfig()
      return reply.send({ success: true, data: config, message: 'Log config reset to defaults' })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to reset log config', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // ─── Log Export ──────────────────────────────────────────────

  // POST /api/logs/export — 导出日志
  app.post('/api/logs/export', async (request, reply) => {
    try {
      const body = request.body as { format: LogExportFormat; filter?: LogFilter; includeMetadata?: boolean; includeDetails?: boolean; compression?: string }
      if (!body.format) return reply.status(400).send({ success: false, error: 'format is required' })

      const validFormats: LogExportFormat[] = ['json', 'csv', 'text', 'html']
      if (!validFormats.includes(body.format)) return reply.status(400).send({ success: false, error: `Format must be one of: ${validFormats.join(', ')}` })

      const options: LogExportOptions = { format: body.format, filter: body.filter, includeMetadata: body.includeMetadata ?? true, includeDetails: body.includeDetails ?? true, compression: (body.compression as 'none' | 'gzip') ?? 'none' }
      const result = await logManager.exportLogs(options)

      const contentTypes: Record<string, string> = { json: 'application/json', text: 'text/plain', csv: 'text/csv', html: 'text/html' }
      reply.header('Content-Type', contentTypes[body.format] || 'application/octet-stream')
      reply.header('Content-Disposition', `attachment; filename="${result.filename}"`)
      reply.header('X-Log-Count', String(result.count))
      reply.header('X-Log-Size', String(result.size))
      return reply.send(result.data)
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to export logs', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // ─── Log Report ──────────────────────────────────────────────

  // POST /api/logs/report — 上报日志
  app.post('/api/logs/report', async (request, reply) => {
    try {
      const body = request.body as { logs?: any[] }
      if (!body.logs || !Array.isArray(body.logs)) return reply.status(400).send({ success: false, error: 'logs array is required' })

      const validLevels = ['debug', 'info', 'warn', 'error', 'fatal']
      const validTypes = ['tool_call', 'system', 'agent_loop', 'workflow', 'user_action', 'performance', 'error', 'security']
      const validSources = ['client', 'server', 'agent', 'tool', 'system']

      const validLogs = body.logs.filter((log: any) => {
        if (!log || typeof log !== 'object') return false
        if (!log.level || !validLevels.includes(log.level)) return false
        if (!log.type || !validTypes.includes(log.type)) return false
        if (!log.source || !validSources.includes(log.source)) return false
        if (!log.message || typeof log.message !== 'string') return false
        return true
      })

      if (validLogs.length > 0) logManager.addLogs(validLogs)
      return reply.send({ success: true, data: { received: body.logs.length, added: validLogs.length, invalid: body.logs.length - validLogs.length } })
    } catch (error) {
      return reply.status(500).send({ success: false, error: 'Failed to report logs', message: error instanceof Error ? error.message : String(error) })
    }
  })

  // ─── Log File (增量读取) ─────────────────────────────────────

  // GET /api/logs/file — 增量读取日志文件
  app.get('/api/logs/file', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>
      const offsetParam = q.offset
      const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0
      const conversationId = q.conversationId

      const logFile = conversationId ? LogManager.getSessionLogFilePath(conversationId) : LogManager.getLogFilePath()
      if (!logFile) return reply.send({ entries: [], offset: 0 })

      if (!fs.existsSync(logFile)) return reply.send({ entries: [], offset: 0 })

      const stat = fs.statSync(logFile)
      const fileSize = stat.size
      const readOffset = offset > fileSize ? 0 : offset
      if (readOffset >= fileSize) return reply.send({ entries: [], offset: readOffset })

      const MAX_READ = 128 * 1024
      const readLen = Math.min(fileSize - readOffset, MAX_READ)
      const buf = Buffer.alloc(readLen)
      const fd = fs.openSync(logFile, 'r')
      fs.readSync(fd, buf, 0, readLen, readOffset)
      fs.closeSync(fd)

      const content = buf.toString('utf-8')
      const lines = content.split('\n').filter(line => line.trim())
      const entries: LogEntry[] = []
      let bytesConsumed = 0

      for (const line of lines) {
        bytesConsumed += Buffer.byteLength(line, 'utf-8') + 1
        try { entries.push(JSON.parse(line) as LogEntry) } catch { /* skip */ }
      }

      return reply.send({ entries, offset: readOffset + bytesConsumed })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // ─── Log Stream (SSE) ───────────────────────────────────────

  // GET /api/logs/stream — SSE 实时日志流
  app.get('/api/logs/stream', async (request, reply) => {
    const q = request.query as Record<string, string>
    const filter: LogFilter = {}
    if (q.level) filter.level = q.level.split(',') as any[]
    if (q.type) filter.type = q.type.split(',') as any[]
    if (q.source) filter.source = q.source.split(',') as any[]
    if (q.conversationId) filter.conversationId = q.conversationId

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const encoder = new TextEncoder()
    const send = (data: any) => {
      try { reply.raw.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { /* ignore */ }
    }

    const initialLogs = logManager.getLogs(filter)
    const sentIds = new Set<string>()
    send({ type: 'connected', timestamp: new Date().toISOString(), message: 'Log stream connected', logCount: initialLogs.length })

    for (const log of initialLogs) {
      sentIds.add(log.id)
      send({ type: 'log', data: log })
    }

    const interval = setInterval(() => {
      try {
        const currentLogs = logManager.getLogs(filter)
        const newLogs = currentLogs.filter((log: LogEntry) => !sentIds.has(log.id))
        for (const log of newLogs) {
          sentIds.add(log.id)
          send({ type: 'log', data: log })
        }
        send({ type: 'heartbeat', timestamp: new Date().toISOString(), logCount: currentLogs.length })
      } catch (error) {
        send({ type: 'error', timestamp: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) })
      }
    }, 1000)

    request.raw.on('close', () => {
      clearInterval(interval)
      try { reply.raw.end() } catch { /* ignore */ }
    })

    setTimeout(() => {
      clearInterval(interval)
      try { reply.raw.end() } catch { /* ignore */ }
    }, 5 * 60 * 1000)
  })
}
