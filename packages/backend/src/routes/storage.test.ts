import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'

describe('storage routes', () => {
  it('returns complete per-volume and aggregate capacity without deriving savings from group inventory', async () => {
    const bootstrap: any = { generation: 1, volumes: [{ id: 'v1', name: 'One', parentPath: '/one', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'v2', name: 'Two', parentPath: '/two', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions:'v1',knowledge:'v1',work:'v1',config:'v1',secrets:'v2',diagnostics:'v2',cache:'v2' } }
    const volume = (volumeId: string, logical: number, physical: number) => ({ volumeId, scanStatus: 'complete' as const, logicalImmutableBytes: logical, physicalImmutableBytes: physical, verifiedDedupSavedBytes: logical - physical, replicaBytes: 2, cleanableBytes: 1, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [] })
    const metrics = { volumes: [volume('v1', 10, 6), volume('v2', 10, 6)], aggregate: { scanStatus: 'complete' as const, logicalImmutableBytes: 20, physicalImmutableBytes: 12, verifiedDedupSavedBytes: 8, replicaBytes: 4, cleanableBytes: 2, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [] } }
    const app = await buildApp({ storage: { resolve: () => '/data' } as any, registerRoutes: false, storageApi: { readBootstrap: async () => bootstrap, inventory: async () => ({ files: 1, bytes: 999, entries: [] }), capacityMetrics: async () => metrics, listBackups: async () => [] } })
    const overview = (await app.inject('/api/storage/overview')).json().data
    expect(overview.capacity).toEqual(metrics.aggregate); expect(overview.inventoryLogicalBytes).toBe(6993); expect(overview.capacity.verifiedDedupSavedBytes).toBe(8)
    const volumes = (await app.inject('/api/storage/volumes')).json().data.volumes
    expect(volumes.map((item: any) => item.capacity.volumeId)).toEqual(['v1', 'v2'])
    await app.close()
  })

  it('exposes overview, volumes, operation status, and backups from injected ASH services', async () => {
    const bootstrap: any = { generation: 3, volumes: [{ id: 'v1', name: 'Default', parentPath: '/data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions:'v1',knowledge:'v1',work:'v1',config:'v1',secrets:'v1',diagnostics:'v1',cache:'v1' }, pendingMigration: { id: 'op1', phase: 'copying' } }
    const app = await buildApp({ storage: { resolve: () => '/data/.manta-ai', close: async()=>{}, quiesce:async()=>{}, checkpoint:async()=>{}, healthCheck:async()=>({ok:true,status:'healthy',warnings:[]}) } as any, registerRoutes: false, storageApi: { readBootstrap: async () => bootstrap, inventory: async () => ({ files: 2, bytes: 12, entries: [] }), getOperation: async (id) => id==='failed-op'?{id,status:'failed',error:'disk lost'}:undefined, listOperations: async () => [{ id:'op-running', status:'running', phase:'copying', updatedAt:'2026-01-01T00:00:02.000Z' }, { id:'op-old', status:'succeeded', phase:'completed', updatedAt:'2026-01-01T00:00:01.000Z' }], listBackups: async () => [{ id: 'b1', operationId:'op1', kind:'group', groupId:'work', volumeId: 'v1', createdAt: '2026-01-01T00:00:00.000Z', bytes: 5 }] } })
    const overview=(await app.inject('/api/storage/overview')).json().data
    expect(overview.totalBytes).toBe(12)
    expect(overview.operation.id).toBe('op-running')
    expect(overview.operations.map((operation:any)=>operation.id)).toEqual(['op-running','op-old'])
    expect((await app.inject('/api/storage/volumes')).json().data.volumes[0].id).toBe('v1')
    expect((await app.inject('/api/storage/operations/op1')).statusCode).toBe(200)
    expect((await app.inject('/api/storage/operations/failed-op')).json().data.operation.status).toBe('failed')
    expect((await app.inject('/api/storage/backups')).json().data.backups[0].id).toBe('b1')
    await app.close()
  })

  it('exposes only typed, credential-free Git binding state for active volumes', async () => {
    const bootstrap: any = { generation: 1, volumes: [{ id: 'v1', name: 'Default', parentPath: '/data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions:'v1',knowledge:'v1',work:'v1',config:'v1',secrets:'v1',diagnostics:'v1',cache:'v1' } }
    const app = await buildApp({ storage: { resolve: () => '/data/.manta-ai' } as any, registerRoutes: false, storageApi: {
      readBootstrap: async () => bootstrap, inventory: async () => ({ files: 0, bytes: 0, entries: [] }), listBackups: async () => [],
      git: {
        capability: async () => ({ available: true, version: '2.47.1' }),
        bindings: async () => [{ volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
        status: async (id: string) => id === 'v1' ? '?? manifest.json\n' : '',
        history: async () => 'abc\tInitial snapshot\n',
      },
    } })
    expect((await app.inject('/api/storage/git/capabilities')).json().data).toEqual({ available: true, version: '2.47.1' })
    const binding = (await app.inject('/api/storage/git/bindings')).json().data.bindings[0]
    expect(binding).toMatchObject({ volumeId: 'v1', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work' })
    expect((await app.inject('/api/storage/volumes/v1/git/status')).json().data.status).toBe('?? manifest.json\n')
    expect((await app.inject('/api/storage/volumes/v1/git/history')).json().data.history).toBe('abc\tInitial snapshot\n')
    expect((await app.inject('/api/storage/volumes/missing/git/status')).statusCode).toBe(404)
    await app.close()
  })

  it('exposes volume folder health separately from backend health so the settings page can explain why automatic sync is paused', async () => {
    const bootstrap: any = { generation: 1, volumes: [{ id: 'v1', name: 'iCloud', parentPath: '/icloud', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: { extensions:'v1',knowledge:'v1',work:'v1',config:'v1',secrets:'v1',diagnostics:'v1',cache:'v1' } }
    const app = await buildApp({ storage: { resolve: () => '/icloud/.manta-ai' } as any, registerRoutes: false, storageApi: {
      readBootstrap: async () => bootstrap, inventory: async () => ({ files: 0, bytes: 0, entries: [] }), listBackups: async () => [],
      volumeHealth: async () => ({ v1: { status: 'unreadable', reason: 'inventory-unreadable', conflicts: [], checkedAt: '2026-07-13T00:00:00.000Z' } }),
    } })
    const overview = (await app.inject('/api/storage/overview')).json().data
    expect(overview.volumeHealth.v1).toMatchObject({ status: 'unreadable', reason: 'inventory-unreadable' })
    await app.close()
  })

  it('exposes sanitized read-only Agent state and structured unavailable/not-found responses', async () => {
    const base: any = { readBootstrap: async () => undefined, inventory: async () => ({ files: 0, bytes: 0, entries: [] }), listBackups: async () => [] }
    const agents = {
      agents: async () => ({ adapters: [{ id: 'codex', displayName: 'Codex', status: 'detected', installations: [{ id: 'codex-user', displayName: 'Codex', nativeRoots: [{ id: 'codex-home', path: '/home/.codex' }] }] }], operations: [{ operationId: 'operation-1', phase: 'applying', status: 'running' }] }),
      assets: async (_adapterId: string, installationId: string) => { if (installationId !== 'codex-user') throw Object.assign(new Error('missing'), { code: 'AGENT_INSTALLATION_NOT_FOUND' }); return { inventory: { schemaVersion: 1, installationId, assets: [{ id: 'codex-instructions', kind: 'instructions', nativePath: '/home/.codex/AGENTS.md' }] }, portableAssets: [{ schemaVersion: 1, id: 'portable', kind: 'instructions' }] } },
      reuse: async () => ({ scanStatus: 'complete', evidenceStatus: 'verified', portableAssetCount: 1, logicalImmutableBytes: 10, uniqueVerifiedObjectBytes: 8, verifiedSavedBytes: 2 }),
      operation: async (id: string) => { if (id !== 'operation-1') throw Object.assign(new Error('missing'), { code: 'AGENT_OPERATION_NOT_FOUND' }); return { operationId: id, adapterId: 'codex', installationId: 'codex-user', kind: 'import', phase: 'applying', status: 'running', verified: false, startedAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:01.000Z', operationCount: 1 } },
    }
    const app = await buildApp({ storage: { resolve: () => '/data' } as any, registerRoutes: false, storageApi: { ...base, agents } })
    const agentState = (await app.inject('/api/storage/agents')).json().data; expect(agentState.adapters[0].status).toBe('detected'); expect(agentState.operations[0]).toMatchObject({ phase: 'applying', status: 'running' })
    expect((await app.inject('/api/storage/agents/codex/installations/codex-user/assets')).json().data.portableAssets[0].id).toBe('portable')
    expect((await app.inject('/api/storage/agents/reuse')).json().data.verifiedSavedBytes).toBe(2)
    const serialized = (await app.inject('/api/storage/agents/operations/operation-1')).body
    expect(JSON.parse(serialized).data.operation).toMatchObject({ phase: 'applying', status: 'running', verified: false }); expect(serialized).not.toContain('plan'); expect(serialized).not.toContain('backup')
    expect((await app.inject('/api/storage/agents/codex/installations/missing/assets')).statusCode).toBe(404)
    expect((await app.inject('/api/storage/agents/operations/missing')).statusCode).toBe(404)
    expect((await app.inject(`/api/storage/agents/operations/${'a'.repeat(129)}`)).statusCode).toBe(404)
    await app.close()

    const unavailable = await buildApp({ storage: { resolve: () => '/data' } as any, registerRoutes: false, storageApi: base })
    expect((await unavailable.inject('/api/storage/agents')).statusCode).toBe(503)
    await unavailable.close()
    const failed = await buildApp({ storage: { resolve: () => '/data' } as any, registerRoutes: false, storageApi: { ...base, agents: { ...agents, agents: async () => { throw new Error('journal unavailable') } } } })
    const failure = await failed.inject('/api/storage/agents'); expect(failure.statusCode).toBe(503); expect(failure.json()).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'AGENT_INTEGRATION_FAILED' }) }))
    await failed.close()
  })
})
