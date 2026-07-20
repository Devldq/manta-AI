import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app'

const storage = {
  resolve: (group: string) => `/data/${group}`,
  healthCheck: async () => ({ ok: true, status: 'healthy', warnings: [] }),
} as any

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
