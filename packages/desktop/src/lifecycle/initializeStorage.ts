import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AshBootstrap, StorageVolumeRecord } from '@manta/shared'
import { BootstrapStore, STORAGE_GROUP_IDS, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'

const STAGING_PREFIX = '.manta-ai.initializing-'
const MARKER = '.ash-initialization.json'
interface InitializationMarker { schemaVersion: 1; transactionId: string; finalRoot: string; createdAt: string }
interface VolumeManifest { schemaVersion: 1; volumeId: string; name: string; state: 'active' | 'backup' | 'archived'; groups: string[]; generation: number; createdAt: string; updatedAt: string }

export class StorageInitializationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'StorageInitializationError' }
}
export interface StorageParentPreview { ok: boolean; parentPath?: string; rootPath?: string; availableBytes?: number; cloudProvider?: 'icloud' | 'onedrive' | 'dropbox'; error?: { code: string; message: string } }

export async function previewStorageParent(parentPath: string, minimumFreeBytes = 256 * 1024 * 1024, hooks: { probe?: (parent: string) => Promise<void> } = {}): Promise<StorageParentPreview> {
  try {
    if (!isAbsolute(parentPath)) throw new StorageInitializationError('INVALID_PATH', 'Storage parent must be an absolute path')
    const parent = resolve(parentPath)
    await mkdir(parent, { recursive: true })
    if (!(await stat(parent)).isDirectory()) throw new StorageInitializationError('NOT_A_DIRECTORY', 'Storage parent is not a directory')
    if (hooks.probe) { try { await hooks.probe(parent) } catch(error) { throw new StorageInitializationError('UNWRITABLE', `Storage parent is not safely writable: ${(error as Error).message}`) } }
    const probe = join(parent, `.manta-ai-probe-${randomUUID()}`); const moved = `${probe}.renamed`
    try {
      await writeFile(probe, 'probe', { flag: 'wx' }); await rename(probe, moved)
      if (await readFile(moved, 'utf8') !== 'probe') throw new Error('probe mismatch')
    } catch (error) { throw new StorageInitializationError('UNWRITABLE', `Storage parent is not safely writable: ${(error as Error).message}`) }
    finally { await rm(probe, { force: true }).catch(() => {}); await rm(moved, { force: true }).catch(() => {}) }
    const fs = await statfs(parent); const availableBytes = Number(fs.bavail) * Number(fs.bsize)
    if (availableBytes < minimumFreeBytes) throw new StorageInitializationError('INSUFFICIENT_SPACE', `At least ${minimumFreeBytes} bytes are required`)
    const lower = parent.toLowerCase(); const cloudProvider = lower.includes('icloud') ? 'icloud' : lower.includes('onedrive') ? 'onedrive' : lower.includes('dropbox') ? 'dropbox' : undefined
    return { ok: true, parentPath: parent, rootPath: volumeRoot(parent), availableBytes, cloudProvider }
  } catch (error) {
    const value = error instanceof StorageInitializationError ? error : new StorageInitializationError((error as NodeJS.ErrnoException).code ?? 'PATH_CHECK_FAILED', (error as Error).message)
    return { ok: false, error: { code: value.code, message: value.message } }
  }
}

function bootstrapFor(parentPath: string, manifest: VolumeManifest): { bootstrap: AshBootstrap; volume: StorageVolumeRecord } {
  const volume = { id: manifest.volumeId, name: manifest.name, parentPath, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt }
  return { volume, bootstrap: { schemaVersion: 1, generation: manifest.generation, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])) as AshBootstrap['groupAssignments'] } }
}
async function readCompleteManifest(root: string): Promise<VolumeManifest> {
  const value = JSON.parse(await readFile(join(root, 'ash-volume.json'), 'utf8')) as VolumeManifest
  if (value.schemaVersion !== 1 || value.state !== 'active' || !value.volumeId || !STORAGE_GROUP_IDS.every((group) => value.groups.includes(group))) throw new Error('manifest does not describe a complete active default volume')
  for (const group of STORAGE_GROUP_IDS) if (!(await stat(join(root, group))).isDirectory()) throw new Error(`missing group ${group}`)
  return value
}
async function commitBootstrap(store: BootstrapStore, expected: AshBootstrap): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await store.read().catch(() => undefined)
    if (current) {
      if (current.volumes[0]?.id === expected.volumes[0]?.id && current.generation === expected.generation) return
      throw new StorageInitializationError('BOOTSTRAP_CONFLICT', 'Another storage location is already initialized')
    }
    try { await store.write(expected) } catch { await new Promise((resolve) => setTimeout(resolve, 5)) }
  }
  const current = await store.read(); if (current?.volumes[0]?.id !== expected.volumes[0]?.id) throw new StorageInitializationError('BOOTSTRAP_COMMIT_FAILED', 'Unable to atomically commit storage Bootstrap')
}
async function recoverFinal(parentPath: string, finalRoot: string, store: BootstrapStore) {
  const result = bootstrapFor(parentPath, await readCompleteManifest(finalRoot)); await commitBootstrap(store, result.bootstrap); return result
}
async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }

async function scanOwnedStaging(parentPath: string, finalRoot: string, store: BootstrapStore): Promise<ReturnType<typeof bootstrapFor> | undefined> {
  for (const name of await readdir(parentPath)) {
    if (!name.startsWith(STAGING_PREFIX)) continue
    const staging = join(parentPath, name); let marker: InitializationMarker
    try { marker = JSON.parse(await readFile(join(staging, MARKER), 'utf8')) as InitializationMarker } catch { continue }
    if (marker.schemaVersion !== 1 || marker.finalRoot !== finalRoot || name !== `${STAGING_PREFIX}${marker.transactionId}`) continue
    try {
      await readCompleteManifest(staging)
      if (!await exists(finalRoot)) { try { await rename(staging, finalRoot) } catch (error) { if (!await exists(finalRoot)) throw error } }
      const result = await recoverFinal(parentPath, finalRoot, store); if (await exists(staging)) await rm(staging, { recursive: true, force: true }); return result
    } catch {
      if (Date.now() - Date.parse(marker.createdAt) < 5 * 60_000) continue
      const quarantine = join(parentPath, `.manta-ai.quarantine-${marker.transactionId}-${randomUUID()}`)
      try { await rename(staging, quarantine) } catch { /* never delete or mutate an unproven foreign directory */ }
    }
  }
  return undefined
}

export async function initializeStorage(options: { parentPath: string; bootstrapPath: string; minimumFreeBytes?: number; name?: string }): Promise<{ bootstrap: AshBootstrap; volume: StorageVolumeRecord }> {
  const preview = await previewStorageParent(options.parentPath, options.minimumFreeBytes)
  if (!preview.ok || !preview.parentPath || !preview.rootPath) throw new StorageInitializationError(preview.error?.code ?? 'INVALID_PATH', preview.error?.message ?? 'Invalid storage parent')
  const parentPath = preview.parentPath; const finalRoot = preview.rootPath; const store = new BootstrapStore(options.bootstrapPath)
  const staged = await scanOwnedStaging(parentPath, finalRoot, store); if (staged) return staged
  if (await exists(finalRoot)) {
    try { return await recoverFinal(parentPath, finalRoot, store) }
    catch (error) { if (error instanceof StorageInitializationError) throw error; throw new StorageInitializationError('TARGET_EXISTS', `${finalRoot} already exists and is not a recoverable ASH initialization: ${(error as Error).message}`) }
  }
  const transactionId = randomUUID(); const staging = join(dirname(finalRoot), `${STAGING_PREFIX}${transactionId}`); const now = new Date().toISOString()
  const volume: StorageVolumeRecord = { id: randomUUID(), name: options.name ?? 'Default', parentPath, createdAt: now, updatedAt: now }
  const bootstrap: AshBootstrap = { schemaVersion: 1, generation: 1, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])) as AshBootstrap['groupAssignments'] }
  let committed = false
  try {
    await mkdir(staging); await writeJsonAtomic(join(staging, MARKER), { schemaVersion: 1, transactionId, finalRoot, createdAt: now })
    for (const group of STORAGE_GROUP_IDS) await mkdir(join(staging, group)); await mkdir(join(staging, '.ash-backups'))
    await writeJsonAtomic(join(staging, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: 'active', groups: [...STORAGE_GROUP_IDS], generation: 1, createdAt: now, updatedAt: now })
    try { await rename(staging, finalRoot); committed = true }
    catch (error) { if (!await exists(finalRoot)) throw error; const result = await recoverFinal(parentPath, finalRoot, store); await rm(staging, { recursive: true, force: true }); return result }
    await commitBootstrap(store, bootstrap); return { bootstrap, volume }
  } catch (error) {
    if (!committed) await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
