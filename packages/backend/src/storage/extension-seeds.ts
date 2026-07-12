import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transactionalInstallDirectory, transactionalWriteExtensionFile } from './extension-transactions'

interface SeedManifest { version: string; entries: Record<string, { sourceHash: string }> }
export interface SeedBundledExtensionsOptions { extensionsRoot: string; seedRoot: string; version: string }

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

export function seedBundledExtensions(options: SeedBundledExtensionsOptions): void {
  const manifestPath = join(options.extensionsRoot, '.ash', 'seed-manifest.json')
  let previous: SeedManifest | undefined
  try { previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as SeedManifest } catch { previous = undefined }
  if (previous?.version === options.version) return
  const sources = [
    { source: join(options.seedRoot, 'skills'), target: join(options.extensionsRoot, 'skills'), group: 'skills' },
    { source: join(options.seedRoot, 'plugins'), target: join(options.extensionsRoot, 'plugins'), group: 'plugins' },
    { source: join(options.seedRoot, '.manta', 'skills'), target: join(options.extensionsRoot, 'skills'), group: 'skills' },
    { source: join(options.seedRoot, '.manta', 'plugins'), target: join(options.extensionsRoot, 'plugins'), group: 'plugins' },
    { source: join(options.seedRoot, '.manta', 'plugin-marketplace'), target: join(options.extensionsRoot, 'plugin-marketplace'), group: 'plugin-marketplace' },
  ]
  const entries: SeedManifest['entries'] = {}
  for (const location of sources) {
    if (!existsSync(location.source)) continue
    for (const name of readdirSync(location.source).sort()) {
      const source = join(location.source, name); const destination = join(location.target, name); const key = `${location.group}/${name}`; const sourceHash = hashTree(source); const prior = previous?.entries[key]
      if (entries[key]) continue
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
