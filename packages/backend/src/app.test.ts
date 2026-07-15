import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app'

describe('full Backend application composition', () => {
  it('registers multipart parsing exactly once when all routes are enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-full-app-'))
    const app = await buildApp({
      storage: {
        resolve: (_group: string, ...segments: string[]) => join(root, ...segments),
        healthCheck: async () => ({ ok: true, status: 'healthy', warnings: [] }),
      } as any,
      isDev: true,
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
    expect((await fetch(`http://127.0.0.1:${address.port}/api/conversations`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${address.port}/api/workspaces`)).status).toBe(200)
    await app.close()
  })
})
