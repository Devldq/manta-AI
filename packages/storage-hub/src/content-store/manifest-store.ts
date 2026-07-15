import { randomUUID } from 'node:crypto'
import { link, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertContentHash, assertContainedPath, ensureSafeDirectory, VolumeObjectStore } from './object-store'
import { withVolumeContentStoreLease } from './content-store-lease'

const ASSET_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const FORBIDDEN_ROOTS = new Set(['.ash', '.git', 'config', 'secrets', 'work', 'diagnostics', 'cache'])
export interface AssetManifestEntry { path: string; hash: string; size: number }
export interface AssetManifest { schemaVersion?: 1; assetId: string; entries: AssetManifestEntry[]; createdAt?: string }

function safeRelative(path: string): void {
  if (!path || path.includes('\0') || /^[\\/]/.test(path) || /^[a-zA-Z]:[\\/]/.test(path)) throw new Error('Asset manifest path must be relative')
  const parts = path.split(/[\\/]+/); if (parts.some((part) => !part || part === '.' || part === '..') || FORBIDDEN_ROOTS.has(parts[0]!)) throw new Error('Asset manifest path is unsafe or targets a mutable group')
}
function safeAssetId(assetId: string): void { if (!ASSET_ID.test(assetId)) throw new Error('Asset manifest asset identifier is invalid') }
function validCreatedAt(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }

/** Per-volume manifests refer only to verified objects in that same volume. */
export class AssetManifestStore {
  readonly volumeRoot: string
  private readonly objects: VolumeObjectStore
  constructor(volumeRoot: string) { this.volumeRoot = resolve(volumeRoot); this.objects = new VolumeObjectStore(this.volumeRoot) }
  pathFor(assetId: string): string { safeAssetId(assetId); const path = resolve(this.volumeRoot, '.ash', 'assets', `${assetId}.json`); assertContainedPath(resolve(this.volumeRoot, '.ash', 'assets'), path, 'Asset manifest path escapes the volume'); return path }
  async write(input: AssetManifest): Promise<Required<AssetManifest>> {
    return withVolumeContentStoreLease(this.volumeRoot, () => this.writeUnderLease(input))
  }
  private async writeUnderLease(input: AssetManifest): Promise<Required<AssetManifest>> {
    const manifest: Required<AssetManifest> = { schemaVersion: 1, assetId: input.assetId, entries: input.entries.map((entry) => ({ ...entry })), createdAt: input.createdAt ?? new Date().toISOString() }
    await this.validate(manifest, input.assetId)
    const path = this.pathFor(input.assetId); await ensureSafeDirectory(this.volumeRoot, dirname(path)); const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await link(temporary, path); return manifest } finally { await rm(temporary, { force: true }) }
  }
  async read(assetId: string): Promise<Required<AssetManifest>> { return withVolumeContentStoreLease(this.volumeRoot, () => this.readUnderLease(assetId)) }
  async readUnderLease(assetId: string): Promise<Required<AssetManifest>> { const parsed: unknown = JSON.parse(await readFile(this.pathFor(assetId), 'utf8')); if (!parsed || typeof parsed !== 'object') throw new Error('Asset manifest is invalid'); const value = parsed as AssetManifest; await this.validate(value, assetId); return { schemaVersion: 1, assetId: value.assetId, entries: value.entries.map((entry) => ({ ...entry })), createdAt: value.createdAt! } }
  private async validate(value: AssetManifest, expectedAssetId: string): Promise<void> {
    safeAssetId(expectedAssetId); if (value.schemaVersion !== 1) throw new Error('Asset manifest schema version is invalid'); safeAssetId(value.assetId); if (value.assetId !== expectedAssetId) throw new Error('Asset manifest asset identifier does not match its file'); if (!validCreatedAt(value.createdAt)) throw new Error('Asset manifest creation timestamp is invalid'); if (!Array.isArray(value.entries)) throw new Error('Asset manifest entries are invalid')
    const paths = new Set<string>(); for (const entry of value.entries) { if (!entry || typeof entry !== 'object') throw new Error('Asset manifest entry is invalid'); safeRelative(entry.path); assertContentHash(entry.hash); if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Asset manifest object size is invalid'); if (paths.has(entry.path)) throw new Error('Asset manifest paths must be unique'); paths.add(entry.path); const object = await this.objects.verify(entry.hash); if (object.size !== entry.size) throw new Error('Asset manifest object size does not match its verified local object') }
  }
}
