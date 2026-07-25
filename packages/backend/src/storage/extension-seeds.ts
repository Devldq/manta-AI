import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { transactionalInstallDirectory, transactionalWriteExtensionFile } from './extension-transactions'
import { installImmutableExtensionPackage, type ImmutableExtensionInstallOptions } from './immutable-extension-install'
import { createContentAssetService } from './content-assets'

interface SeedManifest { version: string; entries: Record<string, { sourceHash: string }> }
type SnapshotPackage = NonNullable<ImmutableExtensionInstallOptions['snapshotPackage']>
export interface SeedBundledExtensionsOptions { extensionsRoot: string; seedRoot: string; version: string; snapshotPackage?: SnapshotPackage }

function hashTree(path: string): string {
  const hash = createHash('sha256')
  const visit = (current: string, relative: string) => {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`Bundled extension seed contains a symbolic link: ${current}`)
    hash.update(`${relative}\0${stat.isDirectory() ? 'd' : 'f'}\0`)
    if (stat.isDirectory()) for (const name of readdirSync(current).sort()) visit(join(current, name), relative ? `${relative}/${name}` : name)
    else hash.update(readFileSync(current))
  }
  visit(path, '')
  return hash.digest('hex')
}

function packageLogicalId(kind: 'skill' | 'plugin', name: string): string {
  return `bundled-${createHash('sha256').update(`${kind}/${name}`).digest('hex').slice(0, 24)}`
}

export async function seedBundledExtensions(options: SeedBundledExtensionsOptions): Promise<void> {
  const manifestPath = join(options.extensionsRoot, '.ash', 'seed-manifest.json')
  let previous: SeedManifest | undefined
  try { previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as SeedManifest } catch { previous = undefined }
  const sameVersion = previous?.version === options.version
  const entries: SeedManifest['entries'] = {}
  const snapshotPackage = options.snapshotPackage ?? createContentAssetService({ volumeRoot: dirname(options.extensionsRoot) }).snapshotPackage
  const packages: Array<{ source: string; target: string; group: string; kind: 'skill' | 'plugin' }> = [
    { source: join(options.seedRoot, 'skills'), target: join(options.extensionsRoot, 'skills'), group: 'skills', kind: 'skill' },
    { source: join(options.seedRoot, 'plugins'), target: join(options.extensionsRoot, 'plugins'), group: 'plugins', kind: 'plugin' },
  ]
  for (const location of packages) {
    if (!existsSync(location.source)) continue
    for (const name of readdirSync(location.source).sort()) {
      const source = join(location.source, name)
      if (!lstatSync(source).isDirectory()) continue
      const destination = join(location.target, name); const key = `${location.group}/${name}`; const prior = previous?.entries[key]
      // The bundle version is the immutable deployment boundary. If that
      // exact version is already installed, do not re-read and re-snapshot
      // every package tree on every Desktop launch.
      if (sameVersion && prior && existsSync(destination)) {
        entries[key] = prior
        continue
      }
      const sourceHash = hashTree(source)
      if (sameVersion && prior?.sourceHash !== sourceHash) continue
      const targetHash = existsSync(destination) ? hashTree(destination) : undefined
      const logicalId = packageLogicalId(location.kind, name)
      if (sameVersion && prior?.sourceHash === sourceHash && targetHash === sourceHash) {
        entries[key] = { sourceHash }
        continue
      }
      if (!existsSync(destination) || (prior && targetHash === prior.sourceHash && targetHash !== sourceHash)) {
        await installImmutableExtensionPackage({ extensionsRoot: options.extensionsRoot, source, destination, kind: location.kind, logicalId, version: options.version, snapshotPackage: options.snapshotPackage })
      } else {
        await snapshotPackage({ kind: location.kind, logicalId, version: options.version, sourceRoot: source })
      }
      entries[key] = { sourceHash }
    }
  }
  if (sameVersion) return
  const sources: Array<{ source: string; target: string; group: string; registry?: 'skill' | 'plugin' }> = [
    { source: join(options.seedRoot, '.manta', 'skills'), target: join(options.extensionsRoot, 'skill-registry'), group: 'skill-registry', registry: 'skill' },
    { source: join(options.seedRoot, '.manta', 'plugins'), target: join(options.extensionsRoot, 'plugin-registry'), group: 'plugin-registry', registry: 'plugin' },
    { source: join(options.seedRoot, '.manta', 'plugin-marketplace'), target: join(options.extensionsRoot, 'plugin-marketplace'), group: 'plugin-marketplace' },
  ]
  for (const location of sources) {
    if (!existsSync(location.source)) continue
    for (const name of readdirSync(location.source).sort()) {
      const source = join(location.source, name); const destination = join(location.target, name); const key = `${location.group}/${name}`; const sourceHash = hashTree(source); const prior = previous?.entries[key]
      if (entries[key]) continue
      if (location.registry) {
        if (!name.endsWith('.json') || !lstatSync(source).isFile()) continue
        let record: Record<string, unknown>
        try { record = JSON.parse(readFileSync(source, 'utf8')) as Record<string, unknown> } catch { throw new Error(`Invalid bundled ${location.registry} registry JSON: ${source}`) }
        const valid = typeof record.id === 'string' && record.id.length > 0 && (location.registry === 'skill' ? typeof record.metadata === 'object' : typeof record.manifest === 'object')
        if (!valid || name !== `${record.id}.json`) throw new Error(`Invalid bundled ${location.registry} registry schema: ${source}`)
      }
      const targetUnmodified = !existsSync(destination) || (prior && hashTree(destination) === prior.sourceHash)
      if (targetUnmodified && (!existsSync(destination) || hashTree(destination) !== sourceHash)) {
        if (lstatSync(source).isDirectory()) transactionalInstallDirectory({ extensionsRoot: options.extensionsRoot, source, destination })
        else transactionalWriteExtensionFile({ extensionsRoot: options.extensionsRoot, destination, content: readFileSync(source, 'utf8') })
      }
      entries[key] = { sourceHash }
    }
  }
  transactionalWriteExtensionFile({ extensionsRoot: options.extensionsRoot, destination: manifestPath, content: JSON.stringify({ version: options.version, entries }, null, 2) })
}
