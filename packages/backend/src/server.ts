import Fastify from 'fastify'
import cors from '@fastify/cors'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── 配置 ───────────────────────────────────────────────────
const PORT = parseInt(process.env.MANTA_PORT ?? '3001', 10)
const HOST = process.env.MANTA_HOST ?? '0.0.0.0'
const IS_DEV = process.env.NODE_ENV !== 'production'
const DATA_DIR = process.env.MANTA_DATA_DIR ?? resolve(process.env.HOME ?? '~', '.manta-data')

// ─── 创建 Fastify 实例 ──────────────────────────────────────
const app = Fastify({
  logger: {
    level: IS_DEV ? 'info' : 'warn',
    transport: IS_DEV
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

// ─── CORS 插件 ──────────────────────────────────────────────
await app.register(cors, {
  origin: IS_DEV
    ? ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001']
    : false,
  credentials: true,
})

// ─── 健康检查 ───────────────────────────────────────────────
app.get('/api/health', async () => {
  return {
    success: true,
    data: {
      status: 'ok',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      dataDir: DATA_DIR,
    },
  }
})

// ─── 静态文件服务（Docker 模式） ─────────────────────────────
if (!IS_DEV) {
  try {
    const { default: fastifyStatic } = await import('@fastify/static')
    const frontendDist = resolve(__dirname, '../../frontend/dist')

    if (existsSync(frontendDist)) {
      await app.register(fastifyStatic, {
        root: frontendDist,
        prefix: '/',
        wildcard: false,
      })

      // SPA fallback: 所有非 API 路由返回 index.html
      app.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith('/api/')) {
          return reply.sendFile('index.html')
        }
        reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
      })

      app.log.info(`Static files served from: ${frontendDist}`)
    }
  } catch (err) {
    app.log.warn('Failed to load static file serving: %s', err instanceof Error ? err.message : String(err))
  }
}

// ─── API 路由注册 ────────────────────────────────────────────
import { agentRoutes } from './routes/agents.js'
import { conversationRoutes } from './routes/conversations.js'
import { conversationDetailRoutes } from './routes/conversation-detail.js'
import { taskRoutes } from './routes/tasks.js'
import { appRoutes } from './routes/apps.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { workspaceDetailRoutes } from './routes/workspace-detail.js'
import { configRoutes } from './routes/config.js'
import { configWorkspaceRoutes } from './routes/config-workspace.js'
import { toolRoutes } from './routes/tools.js'
import { toolsTestRoutes } from './routes/tools-test.js'
import { chatConfigRoutes } from './routes/chat.js'
import { mcpRoutes } from './routes/mcp.js'
import { logRoutes } from './routes/logs.js'
import { fsRoutes } from './routes/fs.js'
import { metricsRoutes } from './routes/metrics.js'
import { pluginRoutes } from './routes/plugins.js'
import { ragRoutes } from './routes/rag.js'
import { readmeRoutes } from './routes/readme.js'
import { runnerRoutes } from './routes/runners.js'
import { workflowRoutes } from './routes/workflow.js'
import { skillRoutes } from './routes/skills.js'
import { default as auditRoutes } from './routes/audit.js'
import { default as approvalRoutes } from './routes/approval.js'
import { default as approvalSSERoutes } from './routes/approval-sse.js'

await app.register(agentRoutes)
await app.register(conversationRoutes)
await app.register(conversationDetailRoutes)
await app.register(taskRoutes)
await app.register(appRoutes)
await app.register(workspaceRoutes)
await app.register(workspaceDetailRoutes)
await app.register(configRoutes)
await app.register(configWorkspaceRoutes)
await app.register(toolRoutes)
await app.register(toolsTestRoutes)
await app.register(chatConfigRoutes)
await app.register(mcpRoutes)
await app.register(logRoutes)
await app.register(fsRoutes)
await app.register(metricsRoutes)
await app.register(pluginRoutes)
await app.register(ragRoutes)
await app.register(readmeRoutes)
await app.register(runnerRoutes)
await app.register(workflowRoutes)
await app.register(skillRoutes)
await app.register(auditRoutes)
await app.register(approvalRoutes)
await app.register(approvalSSERoutes)

// ─── 启动服务器 ─────────────────────────────────────────────
async function start() {
  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`Manta Backend running at http://${HOST}:${PORT}`)
    app.log.info(`Data directory: ${DATA_DIR}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// ─── 优雅关闭 ───────────────────────────────────────────────
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down...`)
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start()
