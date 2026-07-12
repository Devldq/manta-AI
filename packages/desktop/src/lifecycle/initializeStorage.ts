import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AshBootstrap, StorageVolumeRecord } from '@manta/shared'
import { BootstrapStore, STORAGE_GROUP_IDS, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'

export class StorageInitializationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'StorageInitializationError' }
}

export interface StorageParentPreview { ok: boolean; parentPath?: string; rootPath?: string; availableBytes?: number; cloudProvider?: 'icloud' | 'onedrive' | 'dropbox'; error?: { code: string; message: string } }

export async function previewStorageParent(parentPath: string, minimumFreeBytes = 256 * 1024 * 1024): Promise<StorageParentPreview> {
  try {
    if (!isAbsolute(parentPath)) throw new StorageInitializationError('INVALID_PATH', 'Storage parent must be an absolute path')
    const parent = resolve(parentPath); await mkdir(parent, { recursive: true }); const info = await stat(parent)
    if (!info.isDirectory()) throw new StorageInitializationError('NOT_A_DIRECTORY', 'Storage parent is not a directory')
    const probe = join(parent, `.manta-ai-probe-${randomUUID()}`); const moved = `${probe}.renamed`
    try { await writeFile(probe, 'probe', { flag: 'wx' }); await rename(probe, moved); if (await readFile(moved, 'utf8') !== 'probe') throw new Error('probe mismatch') }
    catch (error) { throw new StorageInitializationError('UNWRITABLE', `Storage parent is not safely writable: ${(error as Error).message}`) }
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

export async function initializeStorage(options: { parentPath: string; bootstrapPath: string; minimumFreeBytes?: number; name?: string }): Promise<{ bootstrap: AshBootstrap; volume: StorageVolumeRecord }> {
  const preview = await previewStorageParent(options.parentPath, options.minimumFreeBytes)
  if (!preview.ok || !preview.parentPath || !preview.rootPath) throw new StorageInitializationError(preview.error?.code ?? 'INVALID_PATH', preview.error?.message ?? 'Invalid storage parent')
  const root = preview.rootPath
  try {
    await access(root)
    try {
      const manifest = JSON.parse(await readFile(join(root, 'ash-volume.json'), 'utf8')) as { schemaVersion: number; volumeId: string; name: string; groups: string[]; generation: number; createdAt: string; updatedAt: string }
      if (manifest.schemaVersion !== 1 || !manifest.volumeId || !STORAGE_GROUP_IDS.every((group) => manifest.groups.includes(group))) throw new Error('manifest does not describe a complete default volume')
      for (const group of STORAGE_GROUP_IDS) if (!(await stat(join(root, group))).isDirectory()) throw new Error(`missing group ${group}`)
      const volume: StorageVolumeRecord = { id: manifest.volumeId, name: manifest.name, parentPath: preview.parentPath, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt }
      const bootstrap: AshBootstrap = { schemaVersion: 1, generation: manifest.generation, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])) as AshBootstrap['groupAssignments'] }
      await new BootstrapStore(options.bootstrapPath).write(bootstrap); return { bootstrap, volume }
    } catch (error) { throw new StorageInitializationError('TARGET_EXISTS', `${root} already exists and is not a recoverable ASH initialization: ${(error as Error).message}`) }
  } catch (error) { if (error instanceof StorageInitializationError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const now = new Date().toISOString(); const volume: StorageVolumeRecord = { id: randomUUID(), name: options.name ?? 'Default', parentPath: preview.parentPath, createdAt: now, updatedAt: now }
  const bootstrap: AshBootstrap = { schemaVersion: 1, generation: 1, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])) as AshBootstrap['groupAssignments'] }
  const staging = join(dirname(root), `.manta-ai.initializing-${randomUUID()}`)
  try {
    await mkdir(staging, { recursive: false }); for (const group of STORAGE_GROUP_IDS) await mkdir(join(staging, group))
    await mkdir(join(staging, '.ash-backups')); await writeJsonAtomic(join(staging, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: 'active', groups: [...STORAGE_GROUP_IDS], generation: 1, createdAt: now, updatedAt: now })
    await rename(staging, root); await new BootstrapStore(options.bootstrapPath).write(bootstrap)
    return { bootstrap, volume }
  } catch (error) { await rm(staging, { recursive: true, force: true }).catch(() => {}); await rm(root, { recursive: true, force: true }).catch(() => {}); throw error }
}
