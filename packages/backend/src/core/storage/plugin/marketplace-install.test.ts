import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from '../../../storage/path-routing'
import { createClaudeInstallResource, installClaudePlugin } from './marketplace'

describe('Claude plugin isolated import', () => {
  it('does not leak an active lease when isolation directory creation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-claude-isolation-fail-')); const extensions = join(root, 'extensions'); writeFileSync(extensions, 'not-a-directory')
    const resource = createClaudeInstallResource(extensions)
    await expect(runWithStorageResolver({ resolve: (group: string, ...segments: string[]) => join(root, group === 'extensions' ? 'extensions' : group, ...segments) }, () => installClaudePlugin('demo@claude-plugins-official', { marketplaceCache: null }))).rejects.toThrow()
    expect(() => resource.checkpoint()).not.toThrow()
  })
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
    const assets = readdirSync(join(root, '.manta-ai', '.ash', 'assets')).map((name) => JSON.parse(readFileSync(join(root, '.manta-ai', '.ash', 'assets', name), 'utf8')))
    expect(assets).toHaveLength(1); expect(assets[0].entries.every((entry: { path: string }) => !/registry|plugin-marketplace|ash-cli-staging/.test(entry.path))).toBe(true)
    expect(observed.length).toBeGreaterThanOrEqual(3)
    expect(() => installResource.checkpoint()).not.toThrow()
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value
    delete process.env.SECRET_HOST_VALUE
  })

  it('leaves no partial active package or registry when marketplace snapshot publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-claude-snapshot-fail-')); const resolve = (group: string, ...segments: string[]) => join(root, '.manta-ai', group, ...segments)
    await expect(runWithStorageResolver({ resolve }, () => installClaudePlugin('demo@claude-plugins-official', {
      claudeBin: 'fake-claude', marketplaceCache: null, snapshotPackage: async () => { throw new Error('snapshot fault') },
      execute: async (_bin, args, options) => {
        if (args.join(' ') === 'plugin marketplace list --json') return { stdout: '[]', stderr: '' }
        if (args[0] === 'plugin' && args[1] === 'install') { const packageDir = join(options.env.CLAUDE_CONFIG_DIR!, 'plugins', 'demo'); mkdirSync(join(packageDir, '.claude-plugin'), { recursive: true }); writeFileSync(join(packageDir, '.claude-plugin', 'plugin.json'), '{"name":"demo"}') }
        return { stdout: 'ok', stderr: '' }
      },
    }))).rejects.toThrow(/snapshot fault/)
    const extensions = resolve('extensions'); expect(existsSync(join(extensions, 'plugins', 'claude.demo'))).toBe(false)
    expect(existsSync(join(extensions, 'plugin-registry')) ? readdirSync(join(extensions, 'plugin-registry')) : []).toEqual([])
    expect(readdirSync(join(extensions, '.ash-cli-staging'))).toEqual([])
  })
})
