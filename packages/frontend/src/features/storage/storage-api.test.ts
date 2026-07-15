import { describe, expect, it } from 'vitest'
import { createStorageApi } from './storage-api'

describe('storage API', () => {
  it('uses backend read APIs and returns structured failures without guessing from messages', async () => {
    const calls: string[] = []
    const api = createStorageApi(async (input) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ success: true, data: { volumes: [] } }), { status: 200 })
    })

    await expect(api.volumes()).resolves.toEqual([])
    expect(calls).toEqual(['/api/storage/volumes'])
  })

  it('surfaces server error envelopes to the storage UI', async () => {
    const api = createStorageApi(async () => new Response(JSON.stringify({ success: false, error: { code: 'OFFLINE', message: 'Offline' } }), { status: 503 }))
    await expect(api.overview()).rejects.toMatchObject({ code: 'OFFLINE', message: 'Offline' })
  })

  it('reads typed Git capabilities and bindings without a configuration write endpoint', async () => {
    const calls: string[] = []
    const api = createStorageApi(async (input) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ success: true, data: String(input).endsWith('capabilities') ? { available: true, version: '2.47.1' } : { bindings: [] } }), { status: 200 })
    })
    await expect(api.gitCapabilities()).resolves.toEqual({ available: true, version: '2.47.1' })
    await expect(api.gitBindings()).resolves.toEqual([])
    expect(calls).toEqual(['/api/storage/git/capabilities', '/api/storage/git/bindings'])
  })

  it('preserves nullable verified capacity fields from the backend', async () => {
    const capacity = { scanStatus: 'degraded', logicalImmutableBytes: 12, physicalImmutableBytes: null, verifiedDedupSavedBytes: null, replicaBytes: 3, cleanableBytes: null, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [{ code: 'allocation-unavailable', detail: 'Unavailable' }] }
    const api = createStorageApi(async () => new Response(JSON.stringify({ success: true, data: { volumes: [], groups: [], capacity } }), { status: 200 }))
    await expect(api.overview()).resolves.toMatchObject({ capacity: { physicalImmutableBytes: null, verifiedDedupSavedBytes: null } })
  })

  it('reads Agent connections, inventories, reuse evidence, and sanitized operations', async () => {
    const calls: string[] = []; const api = createStorageApi(async (input) => { const path = String(input); calls.push(path); const data = path.endsWith('/assets') ? { inventory: { schemaVersion: 1, installationId: 'codex-user', assets: [] }, portableAssets: [] } : path.endsWith('/reuse') ? { scanStatus: 'complete', verifiedSavedBytes: 4, materializationStrategies: { clone: 1, copy: 2 } } : path.includes('/operations/') ? { operation: { operationId: 'operation-1', phase: 'applying', status: 'running', verified: false } } : { adapters: [], operations: [{ operationId: 'operation-1', phase: 'applying', status: 'running' }] }; return new Response(JSON.stringify({ success: true, data }), { status: 200 }) })
    await expect(api.agents()).resolves.toMatchObject({ operations: [{ phase: 'applying', status: 'running' }] }); await api.agentAssets('codex', 'codex-user'); await expect(api.agentReuse()).resolves.toMatchObject({ materializationStrategies: { clone: 1, copy: 2 } }); await expect(api.agentOperation('operation-1')).resolves.toMatchObject({ phase: 'applying', status: 'running' })
    expect(calls).toEqual(['/api/storage/agents', '/api/storage/agents/codex/installations/codex-user/assets', '/api/storage/agents/reuse', '/api/storage/agents/operations/operation-1'])
  })
})
