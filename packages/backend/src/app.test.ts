import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { resolveStoragePath } from './storage/path-routing'

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const storage = {
  resolve: (group: string) => `/data/${group}`,
  healthCheck: async () => ({ ok: true, status: 'healthy', warnings: [] }),
} as any

describe('server logging', () => {
  it('keeps the storage resolver available for real HTTP request handlers', async () => {
    const app = await buildApp({ storage, registerRoutes: false })
    app.get('/storage-context', async () => ({ path: resolveStoragePath('work') }))
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/storage-context`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ path: '/data/work' })
    } finally {
      await app.close()
    }
  })

  it('keeps logging opt-in and enables Fastify logs when requested', async () => {
    const quiet = await buildApp({ storage, registerRoutes: false })
    const logged = await buildApp({ storage, registerRoutes: false, logger: true })
    try {
      expect(quiet.log.level).toBeUndefined()
      expect(logged.log.level).toBe('info')
    } finally {
      await Promise.all([quiet.close(), logged.close()])
    }
  })

  it('does not let a long-lived event stream block shutdown', async () => {
    const app = await buildApp({ storage, registerRoutes: false })
    app.get('/events', (_request, reply) => {
      reply.hijack()
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' })
      reply.raw.write('data: connected\n\n')
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address')
    const response = await fetch(`http://127.0.0.1:${address.port}/events`)
    const reader = response.body?.getReader()
    await reader?.read()

    const closing = app.close()
    try {
      await expect(Promise.race([
        closing.then(() => 'closed'),
        delay(250).then(() => 'timed-out'),
      ])).resolves.toBe('closed')
    } finally {
      app.server.closeAllConnections()
      await closing
      await reader?.cancel().catch(() => undefined)
    }
  })
})

describe('desktop frontend hosting', () => {
  it('serves the built frontend and its client-side routes', async () => {
    const frontendDist = await mkdtemp(join(tmpdir(), 'manta-frontend-dist-'))
    await writeFile(join(frontendDist, 'index.html'), '<!doctype html><div id="root">Manta UI</div>')
    await mkdir(join(frontendDist, 'assets'))
    await writeFile(join(frontendDist, 'assets', 'app.js'), 'window.manta = true')
    const app = await buildApp({ storage, isDev: false, registerRoutes: false, frontendDist })

    try {
      await expect(app.inject({ method: 'GET', url: '/' }).then((response) => response.body)).resolves.toContain('Manta UI')
      await expect(app.inject({ method: 'GET', url: '/settings/storage' }).then((response) => response.body)).resolves.toContain('Manta UI')
      await expect(app.inject({ method: 'GET', url: '/assets/app.js' }).then((response) => response.body)).resolves.toContain('window.manta')

      // The desktop service is persistent while Vite rebuilds hashed assets.
      // Files created after service startup must not fall through to index.html.
      await writeFile(join(frontendDist, 'assets', 'app-new-hash.js'), 'window.mantaHash = true')
      const rebuiltAsset = await app.inject({ method: 'GET', url: '/assets/app-new-hash.js' })
      expect(rebuiltAsset.statusCode).toBe(200)
      expect(rebuiltAsset.headers['content-type']).toContain('javascript')
      expect(rebuiltAsset.body).toContain('window.mantaHash')
    } finally {
      await app.close()
    }
  })

  it('fails startup explicitly when the frontend build is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-missing-frontend-'))
    const frontendDist = join(root, 'dist')

    await expect(buildApp({ storage, isDev: false, registerRoutes: false, frontendDist })).rejects.toMatchObject({ code: 'FRONTEND_ASSETS_MISSING' })
  })
})
