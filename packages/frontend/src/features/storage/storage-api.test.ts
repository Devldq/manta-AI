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
})
