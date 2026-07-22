import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import type { StorageHealthResult, StorageResolver } from './storage/runtime'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWithDiagnosticsOwner, type RuntimeDiagnosticsWriter } from './storage/runtime-diagnostics'
import { runWithStorageResolver } from './storage/path-routing'
import { storageRoutes, type StorageApiContext } from './routes/storage'
import { ClientStateStore } from './storage/client-state-store'
import { storageClientStateRoutes } from './routes/storage-client-state'
import { RagStagingStore } from './storage/rag-staging-store'
import { ragStagingRoutes } from './routes/rag-staging'
import type { TaskRuntime } from '@manta/task-runtime'
import { jobRoutes } from './routes/jobs'
import { registerLocalAccess, type LocalAccessOptions } from './local-access'
import { ragV1Routes } from './routes/rag-v1'
import { retrievalLabRoutes } from './routes/retrieval-lab'
import { agentV1Routes } from './routes/agent-v1'
import { skillV1Routes } from './routes/skill-v1'
import type { QdrantProvider } from '@manta/rag/qdrant'

export interface BuildAppOptions { storage: StorageResolver & { diagnosticsWriter?: RuntimeDiagnosticsWriter; healthCheck?: () => Promise<StorageHealthResult> }; ragProvider?: QdrantProvider; isDev?: boolean; logger?: boolean; registerRoutes?: boolean; storageApi?: StorageApiContext; clientState?: ClientStateStore; frontendDist?: string; taskRuntime?: TaskRuntime; apiOnly?: boolean; localAccess?: LocalAccessOptions }

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const isDev = options.isDev ?? process.env.NODE_ENV !== 'production'
  const app = Fastify({ logger: options.logger ?? false })
  try {
  app.decorate('taskRuntime', options.taskRuntime)
  app.decorate('ragProvider', options.ragProvider)
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
  if (options.localAccess) await registerLocalAccess(app, options.localAccess)
  app.get('/api/health', async () => ({ success: true, data: { status: 'ok', version: '2.0.0', timestamp: new Date().toISOString(), dataDir: options.storage.resolve('config') } }))
  app.get('/v1/health', async () => ({ data: { status: 'ok', apiVersion: 'v1', timestamp: new Date().toISOString() } }))
  app.get('/api/health/storage', async () => ({ success: true, data: options.storage.healthCheck ? await options.storage.healthCheck() : { ok: true, status: 'healthy', warnings: [] } }))
  if (options.storageApi) await app.register(storageRoutes, { ...options.storageApi, health: options.storageApi.health ?? options.storage.healthCheck })
  await app.register(storageClientStateRoutes, options.clientState ?? new ClientStateStore(() => options.storage.resolve('config')))
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 50 } })
  const ragStaging = new RagStagingStore()
  await app.register(ragStagingRoutes, ragStaging)
  if (options.taskRuntime) {
    await app.register(jobRoutes, { runtime: options.taskRuntime })
    if (!options.ragProvider) throw new Error('RAG routes require an explicit provider')
    await app.register(ragV1Routes, { runtime: options.taskRuntime, staging: ragStaging, knowledgeRoot: options.storage.resolve('knowledge'), uploadRoot: options.storage.resolve('cache', 'upload-sessions'), provider: options.ragProvider })
    await app.register(retrievalLabRoutes, { runtime: options.taskRuntime, knowledgeRoot: options.storage.resolve('knowledge') })
    await app.register(agentV1Routes, { runtime: options.taskRuntime })
    await app.register(skillV1Routes, {
      runtime: options.taskRuntime,
      extensionsRoot: options.storage.resolve('extensions'),
      grantsPath: options.storage.resolve('extensions', 'skill-grants.json'),
    })
  }
  if (!isDev && !options.apiOnly) {
    const frontendDist = options.frontendDist ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
    const frontendEntry = join(frontendDist, 'index.html')
    if (!existsSync(frontendEntry)) throw Object.assign(new Error(`Frontend assets are missing: ${frontendEntry}`), { code: 'FRONTEND_ASSETS_MISSING' })
    const { default: fastifyStatic } = await import('@fastify/static')
    // The local service outlives Desktop renderer rebuilds. Resolve asset paths
    // at request time so newly hashed Vite bundles are served without requiring
    // a service restart; otherwise the SPA fallback returns index.html as JS.
    await app.register(fastifyStatic, { root: frontendDist, prefix: '/', wildcard: true })
    app.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api/') && !request.url.startsWith('/v1/')) return reply.sendFile('index.html')
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } })
    })
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
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

declare module 'fastify' { interface FastifyInstance { quiesceWrites(): void; taskRuntime?: TaskRuntime; ragProvider?: QdrantProvider } }
