import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { ClientStateStore } from '../storage/client-state-store'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('storage client-state routes', () => {
  it('persists a JSON state through the config-group API and reports invalid payloads', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-client-state-routes-'))
    const app = await buildApp({ storage: { resolve: () => root, close: async()=>{}, quiesce:async()=>{}, checkpoint:async()=>{}, healthCheck:async()=>({ok:true,status:'healthy',warnings:[]}) } as any, registerRoutes: false, clientState: new ClientStateStore(() => root) })
    expect((await app.inject({ method: 'PUT', url: '/api/storage/client-state/theme', payload: { value: { themeId: 'x' } } })).statusCode).toBe(200)
    expect((await app.inject('/api/storage/client-state/theme')).json().data.value).toEqual({ themeId: 'x' })
    expect((await app.inject({ method: 'PUT', url: '/api/storage/client-state/theme', payload: { nope: true } })).statusCode).toBe(400)
    await app.close()
  })
})
