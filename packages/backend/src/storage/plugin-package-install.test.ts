import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from './path-routing'
import { installPluginPackage } from './plugin-package-install'

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)])
}

describe('immutable plugin package installation', () => {
  it('commits package, prepared registry identity, and CAS while excluding the registry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-plugin-package-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'business-id'); mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'shared-bytes')
    const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const installed = await runWithStorageResolver({ resolve }, () => installPluginPackage({ extensionsRoot, source, destination, manifest: { id: 'business-id', name: 'Demo', version: '1.0.0' } }))
    const registry = JSON.parse(readFileSync(join(extensionsRoot, 'plugin-registry', `${installed.id}.json`), 'utf8'))
    expect(registry.id).toBe(installed.id); expect(registry.manifest.id).toBe(installed.id); expect(installed.installPath).toBe(destination)
    const assets = readdirSync(join(volumeRoot, '.ash', 'assets')).map((name) => JSON.parse(readFileSync(join(volumeRoot, '.ash', 'assets', name), 'utf8')))
    expect(assets).toHaveLength(1); expect(assets[0].assetId).toContain(`plugin.${installed.id}.`); expect(assets[0].entries.every((entry: { path: string }) => !entry.path.includes('registry'))).toBe(true)
  })

  it('restores the previous package and registry on snapshot failure while preserving the prepared ID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-plugin-update-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'business-id'); mkdirSync(source); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    writeFileSync(join(source, 'plugin.yaml'), 'v1'); const first = await runWithStorageResolver({ resolve }, () => installPluginPackage({ extensionsRoot, source, destination, manifest: { id: 'business-id', name: 'Demo', version: '1.0.0' } }))
    writeFileSync(join(source, 'plugin.yaml'), 'v2')
    await expect(runWithStorageResolver({ resolve }, () => installPluginPackage({ extensionsRoot, source, destination, manifest: { id: 'business-id', name: 'Demo', version: '2.0.0' }, snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('v1')
    const restored = JSON.parse(readFileSync(join(extensionsRoot, 'plugin-registry', `${first.id}.json`), 'utf8')); expect(restored.id).toBe(first.id); expect(restored.manifest.version).toBe('1.0.0')
  })

  it('deduplicates equal package bytes without merging plugin identities', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-plugin-dedup-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    for (const id of ['one', 'two']) { const source = join(root, id); mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'equal'); await runWithStorageResolver({ resolve }, () => installPluginPackage({ extensionsRoot, source, destination: join(extensionsRoot, 'plugins', id), manifest: { id, name: id, version: '1' } })) }
    const objects = filesUnder(join(volumeRoot, '.ash', 'objects')); expect(objects).toHaveLength(1); expect(objects[0].split(/[\\/]/).at(-1)).toMatch(/^[a-f0-9]{64}$/); expect(readdirSync(join(volumeRoot, '.ash', 'assets'))).toHaveLength(2)
  })

  it('restores a scanned active package when source and destination are equal and snapshot fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-plugin-managed-import-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const active = join(extensionsRoot, 'plugins', 'scanned'); mkdirSync(active, { recursive: true }); writeFileSync(join(active, 'plugin.yaml'), 'original'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await expect(runWithStorageResolver({ resolve }, () => installPluginPackage({ extensionsRoot, source: active, destination: active, manifest: { id: 'scanned', name: 'Scanned', version: '1' }, snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(join(active, 'plugin.yaml'), 'utf8')).toBe('original'); expect(readdirSync(join(extensionsRoot, 'plugin-registry'))).toEqual([])
  })

  it('routes both local plugin entry points and marketplace packages through the shared service', () => {
    const routes = readFileSync(new URL('../routes/plugins.ts', import.meta.url), 'utf8'); const marketplace = readFileSync(new URL('../core/storage/plugin/marketplace.ts', import.meta.url), 'utf8')
    expect(routes.match(/await installPluginPackage\(/g)).toHaveLength(3); expect(routes).not.toContain('transactionalInstallDirectory'); expect(routes).not.toMatch(/\bregisterPlugin\s*\(/)
    expect(marketplace.match(/await installPluginPackage\(/g)).toHaveLength(1); expect(marketplace).not.toContain('transactionalInstallDirectory')
  })
})
