import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('compiled backend package entry', () => {
  it('loads in the Node runtime used by Electron', () => {
    const packageRoot = resolve(__dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { main: string }
    const entryUrl = pathToFileURL(resolve(packageRoot, manifest.main)).href
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `const backend = await import(${JSON.stringify(entryUrl)}); if (typeof backend.startServer !== 'function') throw new Error('startServer export is missing'); process.stdout.write('BACKEND_ENTRY_OK')`,
    ], { cwd: packageRoot, encoding: 'utf8' })

    expect(output).toBe('BACKEND_ENTRY_OK')
  })
})
