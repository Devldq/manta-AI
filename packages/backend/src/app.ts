import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { StorageHealthResult, StorageResolver } from './storage/runtime'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWithDiagnosticsOwner, type RuntimeDiagnosticsWriter } from './storage/runtime-diagnostics'
import { runWithStorageResolver } from './storage/path-routing'
import { storageRoutes, type StorageApiContext } from './routes/storage'
import { ClientStateStore } from './storage/client-state-store'
import { storageClientStateRoutes } from './routes/storage-client-state'
import { RagStagingStore } from './storage/rag-staging-store'
import { ragStagingRoutes } from './routes/rag-staging'

export interface BuildAppOptions { storage: StorageResolver & { diagnosticsWriter?: RuntimeDiagnosticsWriter; healthCheck?: () => Promise<StorageHealthResult> }; isDev?: boolean; registerRoutes?: boolean; storageApi?: StorageApiContext; clientState?: ClientStateStore; frontendDist?: string }

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const isDev = options.isDev ?? process.env.NODE_ENV !== 'production'
  const app = Fastify({ logger: false })
  app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver(options.storage, done))
  let acceptingWrites = true
  app.decorate('quiesceWrites', () => { acceptingWrites = false })
  if (options.storage.diagnosticsWriter) {
    app.addHook('onRequest', (_request, _reply, done) => runWithDiagnosticsOwner(options.storage.diagnosticsWriter!, done))
  }
  app.addHook('onRequest', async (request, reply) => {
    if (!acceptingWrites && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return reply.status(503).send({ success: false, error: { code: 'STORAGE_MIGRATION_IN_PROGRESS', message: 'Storage migration is in progress' } })
    }
  })
  await app.register(cors, {
    origin: isDev ? ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'] : false,
    credentials: true,
  })
  app.get('/api/health', async () => ({ success: true, data: { status: 'ok', version: '2.0.0', timestamp: new Date().toISOString(), dataDir: options.storage.resolve('config') } }))
  app.get('/api/health/storage', async () => ({ success: true, data: options.storage.healthCheck ? await options.storage.healthCheck() : { ok: true, status: 'healthy', warnings: [] } }))
  if (options.storageApi) await app.register(storageRoutes, { ...options.storageApi, health: options.storageApi.health ?? options.storage.healthCheck })
  await app.register(storageClientStateRoutes, options.clientState ?? new ClientStateStore(() => options.storage.resolve('config')))
  const multipart = await import('@fastify/multipart')
  await app.register((multipart as any).default ?? multipart)
  await app.register(ragStagingRoutes, new RagStagingStore())
  if (!isDev) {
    const frontendDist = options.frontendDist ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
    if (existsSync(frontendDist)) {
      const { default: fastifyStatic } = await import('@fastify/static')
      await app.register(fastifyStatic, { root: frontendDist, prefix: '/', wildcard: false })
      app.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith('/api/')) return reply.sendFile('index.html')
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
      })
    }
  }
  if (options.registerRoutes !== false) {
    const routeModules = await Promise.all([
      import('./routes/agents.js'), import('./routes/conversations.js'), import('./routes/conversation-detail.js'),
      import('./routes/tasks.js'), import('./routes/apps.js'), import('./routes/workspaces.js'), import('./routes/workspace-detail.js'),
      import('./routes/config.js'), import('./routes/config-workspace.js'), import('./routes/tools.js'), import('./routes/tools-test.js'),
      import('./routes/chat.js'), import('./routes/mcp.js'), import('./routes/logs.js'), import('./routes/fs.js'), import('./routes/metrics.js'),
      import('./routes/plugins.js'), import('./routes/rag.js'), import('./routes/readme.js'), import('./routes/runners.js'),
      import('./routes/workflow.js'), import('./routes/skills.js'), import('./routes/audit.js'), import('./routes/approval.js'),
      import('./routes/approval-sse.js'),
    ])
    const names = [
      'agentRoutes', 'conversationRoutes', 'conversationDetailRoutes', 'taskRoutes', 'appRoutes', 'workspaceRoutes',
      'workspaceDetailRoutes', 'configRoutes', 'configWorkspaceRoutes', 'toolRoutes', 'toolsTestRoutes', 'chatConfigRoutes',
      'mcpRoutes', 'logRoutes', 'fsRoutes', 'metricsRoutes', 'pluginRoutes', 'ragRoutes', 'readmeRoutes', 'runnerRoutes',
      'workflowRoutes', 'skillRoutes', 'default', 'default', 'default',
    ]
    for (let index = 0; index < routeModules.length; index++) {
      await app.register((routeModules[index] as Record<string, any>)[names[index]])
    }
  }
  return app
}

declare module 'fastify' { interface FastifyInstance { quiesceWrites(): void } }
