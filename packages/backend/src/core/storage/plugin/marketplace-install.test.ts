import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from '../../../storage/path-routing'
import { installClaudePlugin } from './marketplace'

describe('Claude plugin isolated import', () => {
  it('isolates CLI state, imports the real package into ASH, and cleans temporary state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-claude-import-')); const externalHome = join(root, 'external-home'); mkdirSync(externalHome)
    const resolve = (group: string, ...segments: string[]) => join(root, '.manta-ai', group, ...segments)
    const observed: Array<{ home?: string; config?: string; cwd: string }> = []
    const result = await runWithStorageResolver({ resolve }, () => installClaudePlugin('demo@claude-plugins-official', {
      claudeBin: 'fake-claude', marketplaceCache: null,
      execute: async (_bin, args, options) => {
        observed.push({ home: options.env.HOME, config: options.env.CLAUDE_CONFIG_DIR, cwd: options.cwd })
        expect(options.env.HOME).toBe(options.env.USERPROFILE)
        expect(relative(options.env.HOME!, options.env.CLAUDE_CONFIG_DIR!)).not.toMatch(/^\.\./)
        if (args.join(' ') === 'plugin marketplace list --json') return { stdout: '[]', stderr: '' }
        if (args[0] === 'plugin' && args[1] === 'install') {
          const packageDir = join(options.env.CLAUDE_CONFIG_DIR!, 'plugins', 'demo'); mkdirSync(join(packageDir, '.claude-plugin'), { recursive: true }); writeFileSync(join(packageDir, '.claude-plugin', 'plugin.json'), '{"name":"demo"}')
        }
        return { stdout: 'ok', stderr: '' }
      },
    }))
    expect(result.plugin.installPath).toBe(join(root, '.manta-ai', 'extensions', 'plugins', 'claude.demo'))
    expect(existsSync(join(result.plugin.installPath!, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(readdirSync(externalHome)).toEqual([])
    expect(readdirSync(join(root, '.manta-ai', 'extensions', '.ash-cli-staging'))).toEqual([])
    expect(observed.length).toBeGreaterThanOrEqual(3)
  })
})
