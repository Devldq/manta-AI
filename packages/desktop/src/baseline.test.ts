import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop package manifest', () => {
  it('points Electron at the compiled main process', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { main: string }
    expect(manifest.main).toBe('dist/main.js')
  })

  it('packages the mandatory onboarding HTML and all ASH runtime resources', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { scripts: { build: string } }
    const builder = readFileSync(resolve(__dirname, '..', 'electron-builder.yml'), 'utf8')
    expect(manifest.scripts.build).toContain('copy-assets.cjs')
    for (const resource of ['frontend/dist', 'backend/dist', 'storage-hub/dist', 'rag/dist', 'to: .manta', 'better-sqlite3', 'sqlite-vec']) expect(builder).toContain(resource)
  })
})
