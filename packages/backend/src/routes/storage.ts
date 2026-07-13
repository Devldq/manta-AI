import type { AshBootstrap } from '@manta/shared'
import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'
import type { FastifyInstance } from 'fastify'

export interface StorageGitApi {
  capability(): Promise<{ available: boolean; version?: string; reason?: string }>
  bindings(): Promise<Array<{ volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; lastSyncedGroupHashes?: Partial<Record<StorageGroupId, string>>; lastSyncedAt?: string; lastSyncStatus?: 'succeeded'; createdAt: string; updatedAt: string }>>
  status(volumeId: string): Promise<string>
  history(volumeId: string): Promise<string>
}

export interface StorageApiContext {
  readBootstrap(): Promise<AshBootstrap | undefined>
  inventory(scope?: { volumeId?: string; groupId?: any }): Promise<{ files: number; bytes: number; entries: unknown[] }>
  health?(): Promise<{ ok: boolean; status: string }>
  /** Desktop-owned cloud-folder state; distinct from backend database health. */
  volumeHealth?(): Promise<Record<string, { status: 'healthy' | 'offline' | 'unreadable' | 'conflict'; conflicts: string[]; checkedAt: string; reason?: string }>>
  getOperation?(id: string): Promise<unknown | undefined>
  listOperations?(): Promise<Array<{ id: string; status?: string; phase?: string; updatedAt?: string }>>
  listBackups(): Promise<Array<{ id: string; operationId?: string; kind?: string; groupId?: string; volumeId?: string; createdAt: string; bytes: number }>>
  git?: StorageGitApi
}

export async function storageRoutes(app: FastifyInstance, options: StorageApiContext): Promise<void> {
  app.get('/api/storage/overview', async (_request, reply) => {
    const bootstrap = await options.readBootstrap(); if (!bootstrap) return reply.status(503).send({ success: false, error: { code: 'STORAGE_NOT_INITIALIZED', message: 'Storage is not initialized' } })
    const health = await options.health?.() ?? { ok: true, status: 'healthy' }
    const volumeHealth = await options.volumeHealth?.() ?? {}
    const groups = await Promise.all(STORAGE_GROUP_IDS.map(async (id) => {
      const volumeId = bootstrap.groupAssignments[id]
      const volume = bootstrap.volumes.find((candidate) => candidate.id === volumeId)
      try {
        const inventory = await options.inventory({ groupId: id })
        return { id, volumeId, path: volume ? `${volume.parentPath}/.manta-ai/${id}` : '', bytes: inventory.bytes, files: inventory.files, health: health.ok ? health.status : 'unhealthy' }
      } catch { return { id, volumeId, path: volume ? `${volume.parentPath}/.manta-ai/${id}` : '', bytes: 0, files: 0, health: 'unhealthy' } }
    }))
    const logicalBytes = groups.reduce((sum, item) => sum + item.bytes, 0)
    const volumeInventories = await Promise.all(bootstrap.volumes.map((volume) => options.inventory({ volumeId: volume.id })))
    const totalBytes = volumeInventories.reduce((sum, item) => sum + item.bytes, 0)
    const totalFiles = volumeInventories.reduce((sum, item) => sum + item.files, 0)
    const operations = (await options.listOperations?.() ?? []).sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
    const active = operations.find((operation) => operation.status === 'running' || operation.status === 'recovering')
    return { success: true, data: { generation: bootstrap.generation, volumes: bootstrap.volumes, groups, logicalBytes, totalBytes, totalFiles, volumeHealth, operation: active ?? bootstrap.pendingMigration ?? operations[0], operations } }
  })
  app.get('/api/storage/volumes', async (_request, reply) => {
    const bootstrap = await options.readBootstrap(); if (!bootstrap) return reply.status(503).send({ success: false, error: { code: 'STORAGE_NOT_INITIALIZED', message: 'Storage is not initialized' } })
    const volumes = await Promise.all(bootstrap.volumes.map(async (volume) => ({ ...volume, groups: Object.entries(bootstrap.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id), inventory: await options.inventory({ volumeId: volume.id }) })))
    return { success: true, data: { volumes } }
  })
  app.get<{ Params: { id: string } }>('/api/storage/volumes/:id', async (request, reply) => {
    const bootstrap = await options.readBootstrap(); const volume = bootstrap?.volumes.find((item) => item.id === request.params.id)
    if (!bootstrap || !volume) return reply.status(404).send({ success: false, error: { code: 'VOLUME_NOT_FOUND', message: 'Storage volume was not found' } })
    return { success: true, data: { volume: { ...volume, groups: Object.entries(bootstrap.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id), inventory: await options.inventory({ volumeId: volume.id }) } } }
  })
  app.get<{ Params: { id: string } }>('/api/storage/operations/:id', async (request, reply) => {
    const persisted = await options.getOperation?.(request.params.id); const pending = (await options.readBootstrap())?.pendingMigration
    const operation = persisted ?? (pending?.id === request.params.id ? pending : undefined)
    if (!operation) return reply.status(404).send({ success: false, error: { code: 'OPERATION_NOT_FOUND', message: 'Storage operation was not found' } })
    return { success: true, data: { operation } }
  })
  app.get('/api/storage/backups', async () => ({ success: true, data: { backups: await options.listBackups() } }))
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
