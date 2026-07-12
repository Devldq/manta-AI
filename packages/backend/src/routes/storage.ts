import type { AshBootstrap } from '@manta/shared'
import type { FastifyInstance } from 'fastify'

export interface StorageApiContext {
  readBootstrap(): Promise<AshBootstrap | undefined>
  inventory(scope?: { volumeId?: string; groupId?: any }): Promise<{ files: number; bytes: number; entries: unknown[] }>
  listBackups(): Promise<Array<{ id: string; volumeId: string; createdAt: string; bytes: number }>>
}

export async function storageRoutes(app: FastifyInstance, options: StorageApiContext): Promise<void> {
  app.get('/api/storage/overview', async (_request, reply) => {
    const bootstrap = await options.readBootstrap(); if (!bootstrap) return reply.status(503).send({ success: false, error: { code: 'STORAGE_NOT_INITIALIZED', message: 'Storage is not initialized' } })
    const inventories = await Promise.all(bootstrap.volumes.map((volume) => options.inventory({ volumeId: volume.id })))
    return { success: true, data: { generation: bootstrap.generation, volumeCount: bootstrap.volumes.length, groupCount: Object.keys(bootstrap.groupAssignments).length, totalBytes: inventories.reduce((sum, item) => sum + item.bytes, 0), totalFiles: inventories.reduce((sum, item) => sum + item.files, 0), operation: bootstrap.pendingMigration } }
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
    const operation = (await options.readBootstrap())?.pendingMigration
    if (!operation || operation.id !== request.params.id) return reply.status(404).send({ success: false, error: { code: 'OPERATION_NOT_FOUND', message: 'Storage operation was not found' } })
    return { success: true, data: { operation } }
  })
  app.get('/api/storage/backups', async () => ({ success: true, data: { backups: await options.listBackups() } }))
}
