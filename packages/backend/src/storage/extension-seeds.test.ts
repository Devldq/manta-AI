import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedBundledExtensions } from './extension-seeds'
import { initializeBundledExtensionsForStartup } from '../server'

describe('bundled extension seeds', () => {
  it('seeds an empty volume, is idempotent, upgrades unchanged assets, and preserves user edits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seeds-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions'); const source = join(seedRoot, 'skills', 'demo', 'SKILL.md'); mkdirSync(join(seedRoot, 'skills', 'demo'), { recursive: true }); writeFileSync(source, 'v1')
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' }); const installed = join(extensionsRoot, 'skills', 'demo', 'SKILL.md'); expect(readFileSync(installed, 'utf8')).toBe('v1')
    writeFileSync(source, 'changed-without-version'); await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' }); expect(readFileSync(installed, 'utf8')).toBe('v1')
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '2' }); expect(readFileSync(installed, 'utf8')).toBe('changed-without-version')
    writeFileSync(installed, 'user-edit'); writeFileSync(source, 'v3'); await seedBundledExtensions({ extensionsRoot, seedRoot, version: '3' }); expect(readFileSync(installed, 'utf8')).toBe('user-edit')
    expect(readdirSync(join(root, '.ash', 'assets')).filter((name) => name.endsWith('.json'))).toHaveLength(3)
  })

  it('imports historical .manta registry JSON into registries instead of package trees', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-real-seeds-')); const seedRoot = join(root, 'repo'); const extensionsRoot = join(root, 'extensions')
    mkdirSync(join(seedRoot, '.manta', 'skills'), { recursive: true }); mkdirSync(join(seedRoot, '.manta', 'plugins'), { recursive: true })
    writeFileSync(join(seedRoot, '.manta', 'skills', 'skill-demo.json'), JSON.stringify({ id: 'skill-demo', metadata: { name: 'Demo' } }))
    writeFileSync(join(seedRoot, '.manta', 'plugins', 'plugin-demo.json'), JSON.stringify({ id: 'plugin-demo', manifest: { name: 'Demo', version: '1' } }))
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' })
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'skill-registry', 'skill-demo.json'), 'utf8')).id).toBe('skill-demo')
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'plugin-registry', 'plugin-demo.json'), 'utf8')).id).toBe('plugin-demo')
  })

  it('snapshots bundled skill and plugin packages, deduplicates equal bytes, and excludes mutable seed data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seed-assets-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions')
    mkdirSync(join(seedRoot, 'skills', 'same'), { recursive: true }); mkdirSync(join(seedRoot, 'plugins', 'same'), { recursive: true }); mkdirSync(join(seedRoot, '.manta', 'plugin-marketplace', 'cache'), { recursive: true }); mkdirSync(join(seedRoot, '.manta', 'skills'), { recursive: true })
    writeFileSync(join(seedRoot, 'skills', 'same', 'shared.txt'), 'identical'); writeFileSync(join(seedRoot, 'plugins', 'same', 'shared.txt'), 'identical'); writeFileSync(join(seedRoot, '.manta', 'plugin-marketplace', 'cache', 'index.json'), '{}'); writeFileSync(join(seedRoot, '.manta', 'skills', 'skill-old.json'), JSON.stringify({ id: 'skill-old', metadata: {} }))
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '7' })
    const assetFiles = readdirSync(join(root, '.ash', 'assets')).filter((name) => name.endsWith('.json')); expect(assetFiles).toHaveLength(2)
    const manifests = assetFiles.map((name) => JSON.parse(readFileSync(join(root, '.ash', 'assets', name), 'utf8')))
    expect(manifests.flatMap((manifest) => manifest.entries.map((entry: { path: string }) => entry.path)).every((path: string) => !/registry|marketplace|seed-manifest|cache/.test(path))).toBe(true)
    const objectFiles = readdirSync(join(root, '.ash', 'objects')).flatMap((prefix) => readdirSync(join(root, '.ash', 'objects', prefix))); expect(objectFiles).toHaveLength(1)
  })

  it('rolls back a package and leaves the seed manifest unchanged when snapshot publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seed-fault-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions'); const source = join(seedRoot, 'plugins', 'demo', 'plugin.txt'); const installed = join(extensionsRoot, 'plugins', 'demo', 'plugin.txt'); mkdirSync(join(seedRoot, 'plugins', 'demo'), { recursive: true }); writeFileSync(source, 'v1')
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' }); writeFileSync(source, 'v2')
    await expect(seedBundledExtensions({ extensionsRoot, seedRoot, version: '2', snapshotPackage: async () => { throw new Error('snapshot fault') } })).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(installed, 'utf8')).toBe('v1'); expect(JSON.parse(readFileSync(join(extensionsRoot, '.ash', 'seed-manifest.json'), 'utf8')).version).toBe('1')
    expect(existsSync(join(extensionsRoot, '.ash-transactions')) ? readdirSync(join(extensionsRoot, '.ash-transactions')) : []).toEqual([])
  })

  it('awaits bundled seeding before plugin and skill scanning starts', async () => {
    const events: string[] = []; let releaseSeed!: () => void
    const startup = initializeBundledExtensionsForStartup({
      async seed() { events.push('seed:start'); await new Promise<void>((resolve) => { releaseSeed = resolve }); events.push('seed:end') },
      async loadRuntime() {
        events.push('runtime:load')
        return { scanPlugins() { events.push('plugins:scan'); return [{ manifest: {}, dirPath: 'demo' }] }, registerPlugin() { events.push('plugins:register') }, initializeSkills() { events.push('skills:scan') } }
      },
    })
    await Promise.resolve(); expect(events).toEqual(['seed:start']); releaseSeed(); await startup
    expect(events).toEqual(['seed:start', 'seed:end', 'runtime:load', 'plugins:scan', 'plugins:register', 'skills:scan'])
  })
})
