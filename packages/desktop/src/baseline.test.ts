import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop package manifest', () => {
  it('points Electron at the compiled main process', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { main: string }
    expect(manifest.main).toBe('dist/main.js')
  })
})
