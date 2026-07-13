import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertContentHash, VolumeObjectStore } from './object-store'

const ASSET_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const FORBIDDEN_ROOTS = new Set(['.ash', '.git', 'config', 'secrets', 'work', 'diagnostics', 'cache'])
export interface AssetManifestEntry { path: string; hash: string; size: number }
export interface AssetManifest { schemaVersion?: 1; assetId: string; entries: AssetManifestEntry[]; createdAt?: string }

function safeRelative(path: string): void {
  if (!path || path.includes('\0') || /^[\\/]/.test(path) || /^[a-zA-Z]:[\\/]/.test(path)) throw new Error('Asset manifest path must be relative')
  const parts = path.split(/[\\/]+/); if (parts.some((part) => !part || part === '.' || part === '..') || FORBIDDEN_ROOTS.has(parts[0]!)) throw new Error('Asset manifest path is unsafe or targets a mutable group')
}
function safeAssetId(assetId: string): void { if (!ASSET_ID.test(assetId)) throw new Error('Asset manifest asset identifier is invalid') }
function contained(root: string, child: string): boolean { const value = relative(resolve(root), resolve(child)); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..') }

/** Per-volume manifests refer only to verified objects in that same volume. */
export class AssetManifestStore {
  readonly volumeRoot: string
  private readonly objects: VolumeObjectStore
  constructor(volumeRoot: string) { this.volumeRoot = resolve(volumeRoot); this.objects = new VolumeObjectStore(this.volumeRoot) }
  pathFor(assetId: string): string { safeAssetId(assetId); const path = resolve(this.volumeRoot, '.ash', 'assets', `${assetId}.json`); if (!contained(resolve(this.volumeRoot, '.ash', 'assets'), path)) throw new Error('Asset manifest path escapes the volume'); return path }
  async write(input: AssetManifest): Promise<AssetManifest> {
    safeAssetId(input.assetId); const paths = new Set<string>()
    for (const entry of input.entries) { safeRelative(entry.path); assertContentHash(entry.hash); if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Asset manifest object size is invalid'); if (paths.has(entry.path)) throw new Error('Asset manifest paths must be unique'); paths.add(entry.path); const object = await this.objects.verify(entry.hash); if (object.size !== entry.size) throw new Error('Asset manifest object size does not match its verified local object') }
    const manifest: Required<AssetManifest> = { schemaVersion: 1, assetId: input.assetId, entries: input.entries.map((entry) => ({ ...entry })), createdAt: input.createdAt ?? new Date().toISOString() }
    const path = this.pathFor(input.assetId); await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, path); return manifest } finally { await rm(temporary, { force: true }) }
  }
  async read(assetId: string): Promise<Required<AssetManifest>> { const parsed: unknown = JSON.parse(await readFile(this.pathFor(assetId), 'utf8')); if (!parsed || typeof parsed !== 'object') throw new Error('Asset manifest is invalid'); const value = parsed as AssetManifest; await this.validate(value); return { schemaVersion: 1, assetId: value.assetId, entries: value.entries.map((entry) => ({ ...entry })), createdAt: value.createdAt ?? '' } }
  private async validate(value: AssetManifest): Promise<void> { safeAssetId(value.assetId); if (!Array.isArray(value.entries)) throw new Error('Asset manifest entries are invalid'); for (const entry of value.entries) { safeRelative(entry.path); assertContentHash(entry.hash); if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Asset manifest object size is invalid'); const object = await this.objects.verify(entry.hash); if (object.size !== entry.size) throw new Error('Asset manifest object size does not match its verified local object') } }
}
