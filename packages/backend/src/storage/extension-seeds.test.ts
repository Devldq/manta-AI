import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedBundledExtensions } from './extension-seeds'
import { initializeBundledExtensionsForStartup } from '../server'
import { createContentAssetService } from './content-assets'

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)])
}

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
    const objectFiles = filesUnder(join(root, '.ash', 'objects')); expect(objectFiles).toHaveLength(1); expect(objectFiles[0].split(/[\\/]/).at(-1)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not republish an unchanged installed package on every startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seed-unchanged-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions')
    mkdirSync(join(seedRoot, 'skills', 'demo'), { recursive: true }); writeFileSync(join(seedRoot, 'skills', 'demo', 'SKILL.md'), 'unchanged')
    const snapshot = createContentAssetService({ volumeRoot: root }).snapshotPackage
    let snapshots = 0
    const snapshotPackage: typeof snapshot = async (input) => { snapshots++; return snapshot(input) }

    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1', snapshotPackage })
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1', snapshotPackage })

    expect(snapshots).toBe(1)
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

  it('retries a multi-package partial failure without republishing the winner or overwriting later user edits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seed-retry-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions'); const firstSource = join(seedRoot, 'plugins', 'first', 'plugin.txt'); const secondSource = join(seedRoot, 'plugins', 'second', 'plugin.txt')
    mkdirSync(join(seedRoot, 'plugins', 'first'), { recursive: true }); mkdirSync(join(seedRoot, 'plugins', 'second'), { recursive: true }); writeFileSync(firstSource, 'first-v1'); writeFileSync(secondSource, 'second-v1'); await seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' })
    writeFileSync(firstSource, 'first-v2'); writeFileSync(secondSource, 'second-v2'); const snapshot = createContentAssetService({ volumeRoot: root }).snapshotPackage; let calls = 0
    await expect(seedBundledExtensions({ extensionsRoot, seedRoot, version: '2', snapshotPackage: async (input) => { if (++calls === 2) throw new Error('second snapshot failed'); return snapshot(input) } })).rejects.toThrow(/second snapshot failed/)
    expect(JSON.parse(readFileSync(join(extensionsRoot, '.ash', 'seed-manifest.json'), 'utf8')).version).toBe('1'); const assetsAfterFailure = readdirSync(join(root, '.ash', 'assets')).length; const objectsAfterFailure = filesUnder(join(root, '.ash', 'objects')).length
    const firstInstalled = join(extensionsRoot, 'plugins', 'first', 'plugin.txt'); writeFileSync(firstInstalled, 'user-edit-after-partial-success')
    await seedBundledExtensions({ extensionsRoot, seedRoot, version: '2' })
    expect(readFileSync(firstInstalled, 'utf8')).toBe('user-edit-after-partial-success'); expect(readFileSync(join(extensionsRoot, 'plugins', 'second', 'plugin.txt'), 'utf8')).toBe('second-v2'); expect(JSON.parse(readFileSync(join(extensionsRoot, '.ash', 'seed-manifest.json'), 'utf8')).version).toBe('2')
    expect(readdirSync(join(root, '.ash', 'assets')).length).toBe(assetsAfterFailure + 1); expect(filesUnder(join(root, '.ash', 'objects')).length).toBe(objectsAfterFailure + 1)
  })
})
