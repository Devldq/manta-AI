import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'

describe('storage routes', () => {
  it('exposes overview, volumes, operation status, and backups from injected ASH services', async () => {
    const bootstrap: any = { generation: 3, volumes: [{ id: 'v1', name: 'Default', parentPath: '/data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions:'v1',knowledge:'v1',work:'v1',config:'v1',secrets:'v1',diagnostics:'v1',cache:'v1' }, pendingMigration: { id: 'op1', phase: 'copying' } }
    const app = await buildApp({ storage: { resolve: () => '/data/.manta-ai', close: async()=>{}, quiesce:async()=>{}, checkpoint:async()=>{}, healthCheck:async()=>({ok:true,status:'healthy',warnings:[]}) } as any, registerRoutes: false, storageApi: { readBootstrap: async () => bootstrap, inventory: async () => ({ files: 2, bytes: 12, entries: [] }), getOperation: async (id) => id==='failed-op'?{id,status:'failed',error:'disk lost'}:undefined, listBackups: async () => [{ id: 'b1', operationId:'op1', kind:'group', groupId:'work', volumeId: 'v1', createdAt: '2026-01-01T00:00:00.000Z', bytes: 5 }] } })
    expect((await app.inject('/api/storage/overview')).json().data.totalBytes).toBe(12)
    expect((await app.inject('/api/storage/volumes')).json().data.volumes[0].id).toBe('v1')
    expect((await app.inject('/api/storage/operations/op1')).statusCode).toBe(200)
    expect((await app.inject('/api/storage/operations/failed-op')).json().data.operation.status).toBe('failed')
    expect((await app.inject('/api/storage/backups')).json().data.backups[0].id).toBe('b1')
    await app.close()
  })
})
