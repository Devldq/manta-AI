import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireVolumeContentStoreLeaseSync } from '@manta/storage-hub'
import { installImmutableExtensionPackage } from './immutable-extension-install'

describe('immutable extension installation', () => {
  it('publishes an asset manifest whose equal package files share one CAS object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-immutable-install-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo')
    mkdirSync(source); writeFileSync(join(source, 'one.txt'), 'same'); writeFileSync(join(source, 'two.txt'), 'same')
    const result = await installImmutableExtensionPackage({ extensionsRoot, source, destination, kind: 'plugin', logicalId: 'plugin-existing', version: '1.0.0' })
    expect(result.manifest.entries).toHaveLength(2); expect(new Set(result.manifest.entries.map((entry) => entry.hash))).toHaveLength(1)
    const hash = result.manifest.entries[0].hash
    expect(readdirSync(join(volumeRoot, '.ash', 'objects', 'sha256', hash.slice(0, 2)))).toEqual([hash])
    expect(readFileSync(join(destination, 'one.txt'), 'utf8')).toBe('same')
  })

  it('restores previous package and registry when snapshot publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-immutable-fault-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true }); mkdirSync(join(extensionsRoot, 'plugin-registry')); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(registry, 'old-registry')
    await expect(installImmutableExtensionPackage({ extensionsRoot, source, destination, kind: 'plugin', logicalId: 'plugin-existing', version: '2.0.0', registryWrites: new Map([[registry, 'new-registry']]), snapshotPackage: async () => { throw new Error('snapshot fault') } })).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old'); expect(readFileSync(registry, 'utf8')).toBe('old-registry')
  })

  it('cleans a first package and registry when snapshot publication fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-immutable-first-fault-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    await expect(installImmutableExtensionPackage({ extensionsRoot, source, destination, kind: 'plugin', logicalId: 'plugin-new', version: '1.0.0', registryWrites: new Map([[registry, 'new-registry']]), snapshotPackage: async () => { throw new Error('snapshot fault') } })).rejects.toThrow(/snapshot fault/)
    expect(existsSync(destination)).toBe(false); expect(existsSync(registry)).toBe(false)
  })

  it('holds one exclusive lease until the async snapshot decides to keep or roll back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-immutable-lease-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const destination = join(extensionsRoot, 'plugins', 'demo'); const sourceA = join(root, 'source-a'); const sourceB = join(root, 'source-b')
    mkdirSync(sourceA); mkdirSync(sourceB); mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(join(sourceA, 'plugin.yaml'), 'a'); writeFileSync(join(sourceB, 'plugin.yaml'), 'b')
    let entered!: () => void; const snapshotEntered = new Promise<void>((resolve) => { entered = resolve })
    let rejectSnapshot!: (error: Error) => void; const decision = new Promise<never>((_resolve, reject) => { rejectSnapshot = reject })
    const installA = installImmutableExtensionPackage({ extensionsRoot, source: sourceA, destination, kind: 'plugin', logicalId: 'plugin-a', version: '1', snapshotPackage: async () => { entered(); return decision } })
    const outcomeA = installA.then(() => undefined, (error: unknown) => error)
    await snapshotEntered
    expect(() => acquireVolumeContentStoreLeaseSync(volumeRoot)).toThrow(/lock|busy/i)
    const installB = installImmutableExtensionPackage({ extensionsRoot, source: sourceB, destination, kind: 'plugin', logicalId: 'plugin-b', version: '1' })
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('a')
    rejectSnapshot(new Error('snapshot failed')); expect(await outcomeA).toEqual(expect.objectContaining({ message: 'snapshot failed' }))
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old')
    await installB
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('b')
  })
})
