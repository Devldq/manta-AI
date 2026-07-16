import type { AggregateStorageCapacityMetrics, AshBootstrap, StorageVolumeCapacityMetrics } from '@manta/shared'
import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'
import { posix, win32 } from 'node:path'
import { isWindowsPath, volumeRoot } from '@manta/storage-hub'
import type { FastifyInstance, FastifyReply } from 'fastify'

export interface StorageGitApi {
  capability(): Promise<{ available: boolean; version?: string; reason?: string }>
  bindings(): Promise<Array<{ volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; includeSecrets?: boolean; lastSyncedGroupHashes?: Partial<Record<StorageGroupId, string>>; lastSyncedAt?: string; lastSyncStatus?: 'succeeded'; createdAt: string; updatedAt: string }>>
  status(volumeId: string): Promise<string>
  history(volumeId: string): Promise<string>
}

function storageGroupPath(parentPath: string, groupId: StorageGroupId): string {
  const root = volumeRoot(parentPath)
  return isWindowsPath(parentPath) ? win32.join(root, groupId) : posix.join(root, groupId)
}

export interface StorageAgentReadApi {
  agents(): Promise<{ adapters: Array<{ id: string; displayName: string; status: 'detected' | 'not-detected' | 'error'; installations: Array<{ id: string; displayName: string; nativeRoots: Array<{ id: string; path: string }> }>; error?: { code: string; message: string } }>; operations: unknown[] }>
  assets(adapterId: string, installationId: string): Promise<{ inventory: { schemaVersion: 1; installationId: string; assets: Array<{ id: string; kind: string; nativePath: string }> }; portableAssets: Array<{ schemaVersion: 1; id: string; kind: string }> }>
  reuse(): Promise<unknown>
  operation(operationId: string): Promise<unknown>
}

export interface StorageApiContext {
  readBootstrap(): Promise<AshBootstrap | undefined>
  inventory(scope?: { volumeId?: string; groupId?: any }): Promise<{ files: number; bytes: number; entries: unknown[] }>
  capacityMetrics?(): Promise<{ volumes: StorageVolumeCapacityMetrics[]; aggregate: AggregateStorageCapacityMetrics }>
  health?(): Promise<{ ok: boolean; status: string }>
  /** Desktop-owned cloud-folder state; distinct from backend database health. */
  volumeHealth?(): Promise<Record<string, { status: 'healthy' | 'offline' | 'unreadable' | 'conflict'; conflicts: string[]; checkedAt: string; reason?: string }>>
  getOperation?(id: string): Promise<unknown | undefined>
  listOperations?(): Promise<Array<{ id: string; status?: string; phase?: string; updatedAt?: string }>>
  listBackups(): Promise<Array<{ id: string; operationId?: string; kind?: string; groupId?: string; volumeId?: string; createdAt: string; bytes: number }>>
  git?: StorageGitApi
  agents?: StorageAgentReadApi
}

export async function storageRoutes(app: FastifyInstance, options: StorageApiContext): Promise<void> {
  const safeAgentId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  const unavailable = (reply: FastifyReply) => reply.status(503).send({ success: false, error: { code: 'AGENT_INTEGRATION_UNAVAILABLE', message: 'Agent storage integration is unavailable' } })
  const agentError = (reply: FastifyReply, error: unknown) => { const code = (error as { code?: string }).code ?? 'AGENT_INTEGRATION_FAILED'; const status = code === 'AGENT_ADAPTER_NOT_FOUND' || code === 'AGENT_INSTALLATION_NOT_FOUND' || code === 'AGENT_OPERATION_NOT_FOUND' ? 404 : 503; return reply.status(status).send({ success: false, error: { code, message: status === 404 ? 'Agent storage resource was not found' : 'Agent storage integration failed' } }) }
  app.get('/api/storage/overview', async (_request, reply) => {
    const bootstrap = await options.readBootstrap(); if (!bootstrap) return reply.status(503).send({ success: false, error: { code: 'STORAGE_NOT_INITIALIZED', message: 'Storage is not initialized' } })
    const health = await options.health?.() ?? { ok: true, status: 'healthy' }
    const volumeHealth = await options.volumeHealth?.() ?? {}
    const groups = await Promise.all(STORAGE_GROUP_IDS.map(async (id) => {
      const volumeId = bootstrap.groupAssignments[id]
      const volume = bootstrap.volumes.find((candidate) => candidate.id === volumeId)
      try {
        const inventory = await options.inventory({ groupId: id })
        return { id, volumeId, path: volume ? storageGroupPath(volume.parentPath, id) : '', bytes: inventory.bytes, files: inventory.files, health: health.ok ? health.status : 'unhealthy' }
      } catch { return { id, volumeId, path: volume ? storageGroupPath(volume.parentPath, id) : '', bytes: 0, files: 0, health: 'unhealthy' } }
    }))
    const logicalBytes = groups.reduce((sum, item) => sum + item.bytes, 0)
    const volumeInventories = await Promise.all(bootstrap.volumes.map((volume) => options.inventory({ volumeId: volume.id })))
    const totalBytes = volumeInventories.reduce((sum, item) => sum + item.bytes, 0)
    const totalFiles = volumeInventories.reduce((sum, item) => sum + item.files, 0)
    const capacityMetrics = await options.capacityMetrics?.()
    const operations = (await options.listOperations?.() ?? []).sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
    const active = operations.find((operation) => operation.status === 'running' || operation.status === 'recovering')
    return { success: true, data: { generation: bootstrap.generation, volumes: bootstrap.volumes, groups, logicalBytes, totalBytes, totalFiles, inventoryLogicalBytes: logicalBytes, inventoryTotalBytes: totalBytes, inventoryTotalFiles: totalFiles, capacity: capacityMetrics?.aggregate, volumeCapacity: capacityMetrics?.volumes ?? [], volumeHealth, operation: active ?? bootstrap.pendingMigration ?? operations[0], operations } }
  })
  app.get('/api/storage/volumes', async (_request, reply) => {
    const bootstrap = await options.readBootstrap(); if (!bootstrap) return reply.status(503).send({ success: false, error: { code: 'STORAGE_NOT_INITIALIZED', message: 'Storage is not initialized' } })
    const capacity = await options.capacityMetrics?.(); const byVolume = new Map(capacity?.volumes.map((item) => [item.volumeId, item]) ?? [])
    const volumes = await Promise.all(bootstrap.volumes.map(async (volume) => ({ ...volume, groups: Object.entries(bootstrap.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id), inventory: await options.inventory({ volumeId: volume.id }), capacity: byVolume.get(volume.id) })))
    return { success: true, data: { volumes } }
  })
  app.get<{ Params: { id: string } }>('/api/storage/volumes/:id', async (request, reply) => {
    const bootstrap = await options.readBootstrap(); const volume = bootstrap?.volumes.find((item) => item.id === request.params.id)
    if (!bootstrap || !volume) return reply.status(404).send({ success: false, error: { code: 'VOLUME_NOT_FOUND', message: 'Storage volume was not found' } })
    const capacity = (await options.capacityMetrics?.())?.volumes.find((item) => item.volumeId === volume.id)
    return { success: true, data: { volume: { ...volume, groups: Object.entries(bootstrap.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id), inventory: await options.inventory({ volumeId: volume.id }), capacity } } }
  })
  app.get<{ Params: { id: string } }>('/api/storage/operations/:id', async (request, reply) => {
    const persisted = await options.getOperation?.(request.params.id); const pending = (await options.readBootstrap())?.pendingMigration
    const operation = persisted ?? (pending?.id === request.params.id ? pending : undefined)
    if (!operation) return reply.status(404).send({ success: false, error: { code: 'OPERATION_NOT_FOUND', message: 'Storage operation was not found' } })
    return { success: true, data: { operation } }
  })
  app.get('/api/storage/backups', async () => ({ success: true, data: { backups: await options.listBackups() } }))
  app.get('/api/storage/agents', async (_request, reply) => {
    if (!options.agents) return unavailable(reply)
    try { const data = await options.agents.agents(); const failed = data.adapters.find((adapter) => adapter.status === 'error'); if (failed) return reply.status(503).send({ success: false, error: failed.error ?? { code: 'AGENT_DETECTION_FAILED', message: 'Agent storage detection failed' } }); return { success: true, data } } catch (error) { return agentError(reply, error) }
  })
  app.get<{ Params: { adapterId: string; installationId: string } }>('/api/storage/agents/:adapterId/installations/:installationId/assets', async (request, reply) => {
    if (!options.agents) return unavailable(reply); if (!safeAgentId(request.params.adapterId) || !safeAgentId(request.params.installationId)) return reply.status(404).send({ success: false, error: { code: 'AGENT_RESOURCE_NOT_FOUND', message: 'Agent storage resource was not found' } })
    try { const data = await options.agents.assets(request.params.adapterId, request.params.installationId); return { success: true, data: { inventory: { schemaVersion: 1, installationId: data.inventory.installationId, assets: data.inventory.assets.map(({ id, kind, nativePath }) => ({ id, kind, nativePath })) }, portableAssets: data.portableAssets } } } catch (error) { return agentError(reply, error) }
  })
  app.get('/api/storage/agents/reuse', async (_request, reply) => { if (!options.agents) return unavailable(reply); try { return { success: true, data: await options.agents.reuse() } } catch (error) { return agentError(reply, error) } })
  app.get<{ Params: { operationId: string } }>('/api/storage/agents/operations/:operationId', async (request, reply) => { if (!options.agents) return unavailable(reply); if (!safeAgentId(request.params.operationId)) return reply.status(404).send({ success: false, error: { code: 'AGENT_OPERATION_NOT_FOUND', message: 'Agent storage resource was not found' } }); try { return { success: true, data: { operation: await options.agents.operation(request.params.operationId) } } } catch (error) { return agentError(reply, error) } })
  app.get('/api/storage/git/capabilities', async () => ({ success: true, data: await options.git?.capability() ?? { available: false, reason: 'Git integration is unavailable' } }))
  app.get('/api/storage/git/bindings', async () => ({ success: true, data: { bindings: await options.git?.bindings() ?? [] } }))
  app.get<{ Params: { id: string } }>('/api/storage/volumes/:id/git/status', async (request, reply) => {
    const bootstrap = await options.readBootstrap()
    if (!bootstrap?.volumes.some((volume) => volume.id === request.params.id)) return reply.status(404).send({ success: false, error: { code: 'VOLUME_NOT_FOUND', message: 'Storage volume was not found' } })
    if (!options.git) return reply.status(503).send({ success: false, error: { code: 'GIT_UNAVAILABLE', message: 'Git integration is unavailable' } })
    return { success: true, data: { status: await options.git.status(request.params.id) } }
  })
  app.get<{ Params: { id: string } }>('/api/storage/volumes/:id/git/history', async (request, reply) => {
    const bootstrap = await options.readBootstrap()
    if (!bootstrap?.volumes.some((volume) => volume.id === request.params.id)) return reply.status(404).send({ success: false, error: { code: 'VOLUME_NOT_FOUND', message: 'Storage volume was not found' } })
    if (!options.git) return reply.status(503).send({ success: false, error: { code: 'GIT_UNAVAILABLE', message: 'Git integration is unavailable' } })
    return { success: true, data: { history: await options.git.history(request.params.id) } }
  })
}
