import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop package manifest', () => {
  it('points Electron at the compiled main process', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { main: string }
    expect(manifest.main).toBe('dist/main.js')
  })

  it('starts when Electron CLI owns require.main', () => {
    const entry = readFileSync(resolve(__dirname, 'main.ts'), 'utf8')
    expect(entry).toContain("require.main?.filename === 'electron'")
  })

  it('uses the ABI-safe development launcher', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { scripts: { dev: string } }
    expect(manifest.scripts.dev).toContain('node scripts/run-dev.cjs')
  })

  it('packages the mandatory onboarding HTML and all ASH runtime resources', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { scripts: { build: string } }
    const builder = readFileSync(resolve(__dirname, '..', 'electron-builder.yml'), 'utf8')
    expect(manifest.scripts.build).toContain('copy-assets.cjs')
    for (const resource of ['frontend/dist', 'backend/dist', 'storage-hub/dist', 'rag/dist', 'to: .manta', 'better-sqlite3', 'sqlite-vec']) expect(builder).toContain(resource)
  })
})
