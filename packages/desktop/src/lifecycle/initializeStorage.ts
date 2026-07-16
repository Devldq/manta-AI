import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ASH_VOLUME_DIR_NAME, type AshBootstrap, type StorageVolumeRecord } from '@manta/shared'
import { BootstrapStore, STORAGE_GROUP_IDS, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'
import type { OnboardingProgressReporter, OnboardingProgressStepId } from '../onboarding/progress-contract'
import { withPreparedVolumeRoot } from './LegacyVolumeUpgrade'

const STAGING_PREFIX = `${ASH_VOLUME_DIR_NAME}.initializing-`
const PROBE_PREFIX = `${ASH_VOLUME_DIR_NAME}-probe-`
const QUARANTINE_PREFIX = `${ASH_VOLUME_DIR_NAME}.quarantine-`
const MARKER = '.ash-initialization.json'
interface InitializationMarker { schemaVersion: 1; transactionId: string; finalRoot: string; createdAt: string }
interface VolumeManifest { schemaVersion: 1; volumeId: string; name: string; state: 'active' | 'backup' | 'archived'; groups: string[]; generation: number; createdAt: string; updatedAt: string }

export class StorageInitializationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'StorageInitializationError' }
}
export interface StorageParentPreview { ok: boolean; parentPath?: string; rootPath?: string; availableBytes?: number; cloudProvider?: 'icloud' | 'onedrive' | 'dropbox'; error?: { code: string; message: string } }

interface ValidatedStorageParent { parentPath: string; availableBytes: number; cloudProvider?: 'icloud' | 'onedrive' | 'dropbox' }
export interface StorageValidationHooks { probe?: (parent: string) => Promise<void> }

export async function normalizeStorageParent(parentPath: string): Promise<string> {
  try {
    if (!isAbsolute(parentPath)) throw new StorageInitializationError('INVALID_PATH', 'Storage parent must be an absolute path')
    const parent = resolve(parentPath)
    await mkdir(parent, { recursive: true })
    if (!(await stat(parent)).isDirectory()) throw new StorageInitializationError('NOT_A_DIRECTORY', 'Storage parent is not a directory')
    return parent
  } catch (error) {
    const value = error instanceof StorageInitializationError ? error : new StorageInitializationError((error as NodeJS.ErrnoException).code ?? 'PATH_CHECK_FAILED', (error as Error).message)
    throw value
  }
}

export async function validateStorageParentForCreation(parentPath: string, minimumFreeBytes = 256 * 1024 * 1024, hooks: StorageValidationHooks = {}): Promise<ValidatedStorageParent> {
  try {
    if (hooks.probe) { try { await hooks.probe(parentPath) } catch(error) { throw new StorageInitializationError('UNWRITABLE', `Storage parent is not safely writable: ${(error as Error).message}`) } }
    const probe = join(parentPath, `${PROBE_PREFIX}${randomUUID()}`); const moved = `${probe}.renamed`
    try {
      await writeFile(probe, 'probe', { flag: 'wx' }); await rename(probe, moved)
      if (await readFile(moved, 'utf8') !== 'probe') throw new Error('probe mismatch')
    } catch (error) { throw new StorageInitializationError('UNWRITABLE', `Storage parent is not safely writable: ${(error as Error).message}`) }
    finally { await rm(probe, { force: true }).catch(() => {}); await rm(moved, { force: true }).catch(() => {}) }
    const fs = await statfs(parentPath); const availableBytes = Number(fs.bavail) * Number(fs.bsize)
    if (availableBytes < minimumFreeBytes) throw new StorageInitializationError('INSUFFICIENT_SPACE', `At least ${minimumFreeBytes} bytes are required`)
    const lower = parentPath.toLowerCase(); const cloudProvider = lower.includes('icloud') ? 'icloud' : lower.includes('onedrive') ? 'onedrive' : lower.includes('dropbox') ? 'dropbox' : undefined
    return { parentPath, availableBytes, cloudProvider }
  } catch (error) {
    const value = error instanceof StorageInitializationError ? error : new StorageInitializationError((error as NodeJS.ErrnoException).code ?? 'PATH_CHECK_FAILED', (error as Error).message)
    throw value
  }
}

export async function previewStorageParent(parentPath: string, minimumFreeBytes = 256 * 1024 * 1024, hooks: StorageValidationHooks = {}): Promise<StorageParentPreview> {
  try {
    const normalized = await normalizeStorageParent(parentPath)
    const validated = await validateStorageParentForCreation(normalized, minimumFreeBytes, hooks)
    return { ok: true, ...validated, rootPath: volumeRoot(validated.parentPath) }
  } catch (error) {
    const value = error as StorageInitializationError
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

async function runProgressStep<T>(step: OnboardingProgressStepId, report: OnboardingProgressReporter | undefined, operation: () => Promise<T>): Promise<T> {
  report?.({ step, state: 'active' })
  try {
    const result = await operation()
    report?.({ step, state: 'complete' })
    return result
  } catch (error) {
    report?.({ step, state: 'failed' })
    throw error
  }
}

async function verifyCommittedStorage(finalRoot: string, store: BootstrapStore, expected: AshBootstrap): Promise<void> {
  const manifest = await readCompleteManifest(finalRoot)
  const actual = await store.read()
  if (!actual || actual.generation !== expected.generation || actual.volumes[0]?.id !== manifest.volumeId || actual.volumes[0]?.id !== expected.volumes[0]?.id) {
    throw new StorageInitializationError('STORAGE_VERIFICATION_FAILED', 'Initialized storage did not pass Bootstrap readback verification')
  }
}

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
      const quarantine = join(parentPath, `${QUARANTINE_PREFIX}${marker.transactionId}-${randomUUID()}`)
      try { await rename(staging, quarantine) } catch { /* never delete or mutate an unproven foreign directory */ }
    }
  }
  return undefined
}

export async function initializeStorage(options: { parentPath: string; bootstrapPath: string; minimumFreeBytes?: number; name?: string; onProgress?: OnboardingProgressReporter; validationHooks?: StorageValidationHooks }): Promise<{ bootstrap: AshBootstrap; volume: StorageVolumeRecord }> {
  options.onProgress?.({ step: 'validate-parent', state: 'active' })
  let validationSettled = false
  try {
    const parentPath = await normalizeStorageParent(options.parentPath)
    return await withPreparedVolumeRoot(parentPath, async (finalRoot) => {
      const store = new BootstrapStore(options.bootstrapPath)
      const staged = await scanOwnedStaging(parentPath, finalRoot, store)
      if (staged) {
        options.onProgress?.({ step: 'validate-parent', state: 'complete' })
        validationSettled = true
        return staged
      }
      if (await exists(finalRoot)) {
        try {
          const recovered = await recoverFinal(parentPath, finalRoot, store)
          options.onProgress?.({ step: 'validate-parent', state: 'complete' })
          validationSettled = true
          return recovered
        } catch (error) { if (error instanceof StorageInitializationError) throw error; throw new StorageInitializationError('TARGET_EXISTS', `${finalRoot} already exists and is not a recoverable ASH initialization: ${(error as Error).message}`) }
      }
      await validateStorageParentForCreation(parentPath, options.minimumFreeBytes, options.validationHooks)
      options.onProgress?.({ step: 'validate-parent', state: 'complete' })
      validationSettled = true
    const transactionId = randomUUID(); const staging = join(dirname(finalRoot), `${STAGING_PREFIX}${transactionId}`); const now = new Date().toISOString()
    const volume: StorageVolumeRecord = { id: randomUUID(), name: options.name ?? 'Default', parentPath, createdAt: now, updatedAt: now }
    const bootstrap: AshBootstrap = { schemaVersion: 1, generation: 1, volumes: [volume], groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((id) => [id, volume.id])) as AshBootstrap['groupAssignments'] }
    let committed = false
    try {
      await runProgressStep('create-volume', options.onProgress, async () => {
        await mkdir(staging)
        await writeJsonAtomic(join(staging, MARKER), { schemaVersion: 1, transactionId, finalRoot, createdAt: now })
      })
      await runProgressStep('create-groups', options.onProgress, async () => {
        for (const group of STORAGE_GROUP_IDS) await mkdir(join(staging, group))
        await mkdir(join(staging, '.ash-backups'))
      })
      await runProgressStep('write-manifest', options.onProgress, () => writeJsonAtomic(join(staging, 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: 'active', groups: [...STORAGE_GROUP_IDS], generation: 1, createdAt: now, updatedAt: now }))
      const racedResult = await runProgressStep('commit-bootstrap', options.onProgress, async () => {
        try { await rename(staging, finalRoot); committed = true }
        catch (error) {
          if (!await exists(finalRoot)) throw error
          const result = await recoverFinal(parentPath, finalRoot, store)
          await rm(staging, { recursive: true, force: true })
          return result
        }
        await commitBootstrap(store, bootstrap)
        return undefined
      })
      const result = racedResult ?? { bootstrap, volume }
      await runProgressStep('verify-storage', options.onProgress, () => verifyCommittedStorage(finalRoot, store, result.bootstrap))
      return result
    } catch (error) {
      if (!committed) await rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    })
  } catch (error) {
    if (!validationSettled) options.onProgress?.({ step: 'validate-parent', state: 'failed' })
    throw error
  }
}
