import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from '../../../storage/path-routing'
import { createClaudeInstallResource, installClaudePlugin } from './marketplace'

describe('Claude plugin isolated import', () => {
  it('isolates CLI state, imports the real package into ASH, and cleans temporary state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-claude-import-')); const externalHome = join(root, 'external-home'); mkdirSync(externalHome)
    const external = Object.fromEntries(['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TEMP', 'TMP', 'TMPDIR'].map((key) => {
      const directory = join(root, `external-${key}`); mkdirSync(directory); return [key, directory]
    }))
    const before = Object.fromEntries([...Object.keys(external), 'HOME', 'USERPROFILE'].map((key) => [key, process.env[key]]))
    Object.assign(process.env, external, { HOME: externalHome, USERPROFILE: externalHome, SECRET_HOST_VALUE: 'must-not-leak' })
    const resolve = (group: string, ...segments: string[]) => join(root, '.manta-ai', group, ...segments)
    const installResource = createClaudeInstallResource(resolve('extensions'))
    const observed: Array<{ home?: string; config?: string; cwd: string }> = []
    const result = await runWithStorageResolver({ resolve }, () => installClaudePlugin('demo@claude-plugins-official', {
      claudeBin: 'fake-claude', marketplaceCache: null,
      execute: async (_bin, args, options) => {
        observed.push({ home: options.env.HOME, config: options.env.CLAUDE_CONFIG_DIR, cwd: options.cwd })
        expect(options.env.HOME).toBe(options.env.USERPROFILE)
        expect(relative(options.env.HOME!, options.env.CLAUDE_CONFIG_DIR!)).not.toMatch(/^\.\./)
        for (const key of Object.keys(external)) {
          expect(relative(options.cwd, options.env[key]!)).not.toMatch(/^\.\./)
          writeFileSync(join(options.env[key]!, `${key}.probe`), 'isolated')
        }
        expect(options.env.SECRET_HOST_VALUE).toBeUndefined()
        if (args.join(' ') === 'plugin marketplace list --json') return { stdout: '[]', stderr: '' }
        if (args[0] === 'plugin' && args[1] === 'install') {
          expect(() => installResource.checkpoint()).toThrow(/still active/i)
          const packageDir = join(options.env.CLAUDE_CONFIG_DIR!, 'plugins', 'demo'); mkdirSync(join(packageDir, '.claude-plugin'), { recursive: true }); writeFileSync(join(packageDir, '.claude-plugin', 'plugin.json'), '{"name":"demo"}')
        }
        return { stdout: 'ok', stderr: '' }
      },
    }))
    expect(result.plugin.installPath).toBe(join(root, '.manta-ai', 'extensions', 'plugins', 'claude.demo'))
    expect(existsSync(join(result.plugin.installPath!, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(readdirSync(externalHome)).toEqual([])
    for (const directory of Object.values(external)) expect(readdirSync(directory)).toEqual([])
    expect(readdirSync(join(root, '.manta-ai', 'extensions', '.ash-cli-staging'))).toEqual([])
    expect(observed.length).toBeGreaterThanOrEqual(3)
    expect(() => installResource.checkpoint()).not.toThrow()
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value
    delete process.env.SECRET_HOST_VALUE
  })
})
