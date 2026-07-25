import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { BootstrapStore, inspectFolderHealth, inventoryTree, volumeRoot } from '@manta/storage-hub'
import { DesktopLifecycleController } from './lifecycle/DesktopLifecycleController'
import { initializeStorageDirectory } from './lifecycle/initializeStorage'
import { createStorageVolume } from './lifecycle/createStorageVolume'
import { registerStorageIpc } from './ipc/registerStorageIpc'
import { registerOnboardingIpc as registerSecureOnboardingIpc } from './ipc/registerOnboardingIpc'
import { SelectionStore, type SelectionPurpose } from './ipc/SelectionStore'
import { createMainWindow } from './windows/createMainWindow'
import { createOnboardingWindow, onboardingPageUrl } from './windows/createOnboardingWindow'
import { StorageControlStore, type RelaunchIntent } from './lifecycle/StorageControlStore'
import type { StorageOperationProgress } from '@manta/shared'
import { assertDeletableBackup, buildBackupRefs, pathExists, restoreRelaunchIntent, trustedBackupRefs, validateRelaunchIntent } from './lifecycle/RelaunchRecovery'
import { createCloudSyncRuntime } from './lifecycle/createCloudSyncRuntime'
import { shouldTrackStorageProgress, trackedRecoveredMigrationKind } from './lifecycle/RecoveredMigrationKind'
import { upgradeBootstrapVolumeDirectories } from './lifecycle/LegacyVolumeUpgrade'
import { createDesktopSessionURL, createLocalManta, stopLocalService } from '@manta/sdk/node'
import { serviceLogPath } from '@manta/service'
import { followLogFile, type StopFollowingLog } from './logging/followLogFile'

interface BackendModule {
  createBackendStorageComposition(store: BootstrapStore, options?: { onProgress?: (progress: unknown) => void; onAgentProgress?: (progress: unknown) => void; deferAgentRecovery?: boolean }): Promise<any>
  startServer(options: any): Promise<any>
}

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>
const useLocalService = process.env.MANTA_EMBEDDED_BACKEND !== '1'
// Cold starts may need to recover storage and hash bundled extensions before
// the Service publishes its descriptor. Keep the shorter SDK default for CLI
// callers, but let Desktop wait through the full recovery window.
const DESKTOP_SERVICE_STARTUP_TIMEOUT_MS = 5 * 60_000

function serviceEnvironment(): NodeJS.ProcessEnv {
  return {
    MANTA_HOME: app.getPath('userData'),
    MANTA_BOOTSTRAP_PATH: bootstrapPath(),
    MANTA_BUNDLED_ASSETS_DIR: app.isPackaged ? process.resourcesPath : join(__dirname, '../../..'),
    MANTA_FRONTEND_DIST: app.isPackaged ? join(process.resourcesPath, 'frontend', 'dist') : join(__dirname, '../../frontend/dist'),
    MANTA_QDRANT_BINARY: localQdrantBinary(),
    ...(!app.isPackaged ? { MANTA_TERMINAL_LOGS: '1' } : {}),
    ...(process.env.QDRANT_URL ? { QDRANT_URL: process.env.QDRANT_URL } : {}),
  }
}

async function serviceRendererHandle() {
  const rendererUrl = await createDesktopServiceSessionURL()
  const endpoint = new URL(rendererUrl).origin
  return {
    port: Number(new URL(endpoint).port),
    rendererUrl,
    async quiesce() {},
    async close() {},
    async healthCheck() {
      try {
        const response = await fetch(`${endpoint}/v1/health`, { signal: AbortSignal.timeout(2_000) })
        return response.ok ? { ok: true } : { ok: false, error: `Manta Service health returned ${response.status}` }
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
    },
  }
}

export function createDesktopServiceSessionURL(): Promise<string> {
  return createDesktopSessionURL({
    home: app.getPath('userData'),
    environment: serviceEnvironment(),
    startupTimeoutMs: DESKTOP_SERVICE_STARTUP_TIMEOUT_MS,
  })
}

interface ManagedQdrant {
  url: string
  owned: boolean
  stop(): Promise<void>
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function qdrantReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/collections`, { signal: AbortSignal.timeout(750) })
    if (!response.ok) return false
    const body = await response.json() as { result?: { collections?: unknown[] } }
    return Array.isArray(body.result?.collections)
  } catch {
    return false
  }
}

function exposeQdrantUrl(url: string): () => void {
  const previousUrl = process.env.QDRANT_URL
  process.env.QDRANT_URL = url
  return () => {
    if (process.env.QDRANT_URL !== url) return
    if (previousUrl === undefined) delete process.env.QDRANT_URL
    else process.env.QDRANT_URL = previousUrl
  }
}

function localQdrantBinary(): string {
  if (process.env.MANTA_QDRANT_BINARY) return process.env.MANTA_QDRANT_BINARY
  const executable = process.platform === 'win32' ? 'qdrant.exe' : 'qdrant'
  if (app.isPackaged) return join(process.resourcesPath, 'qdrant', executable)
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform
  return join(__dirname, '..', '.qdrant', `${os}-${process.arch}`, executable)
}

async function stopChild(child: ChildProcess, exited: () => boolean, exitPromise: Promise<void>): Promise<void> {
  if (exited()) return
  child.kill('SIGTERM')
  await Promise.race([exitPromise, delay(5_000)])
  if (!exited()) {
    child.kill('SIGKILL')
    await Promise.race([exitPromise, delay(1_000)])
  }
}

async function startManagedQdrant(): Promise<ManagedQdrant> {
  const configuredUrl = process.env.QDRANT_URL?.replace(/\/$/, '')
  if (configuredUrl) {
    if (!await qdrantReady(configuredUrl)) {
      throw Object.assign(new Error(`配置的 Qdrant 不可用：${configuredUrl}`), { code: 'QDRANT_EXTERNAL_UNAVAILABLE' })
    }
    return { url: configuredUrl, owned: false, async stop() {} }
  }

  const url = 'http://127.0.0.1:6333'
  if (await qdrantReady(url)) {
    const restoreEnvironment = exposeQdrantUrl(url)
    return { url, owned: false, async stop() { restoreEnvironment() } }
  }

  const binary = localQdrantBinary()
  try { await access(binary) } catch {
    throw Object.assign(new Error(`本地 Qdrant binary 不存在：${binary}。请重新执行 pnpm dev:desktop 或重新安装 Manta。`), { code: 'QDRANT_BINARY_MISSING' })
  }

  const root = join(app.getPath('userData'), 'qdrant')
  const storage = join(root, 'storage')
  const snapshots = join(root, 'snapshots')
  await Promise.all([mkdir(storage, { recursive: true }), mkdir(snapshots, { recursive: true })])

  const child = spawn(binary, [], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      QDRANT__SERVICE__HOST: '127.0.0.1',
      QDRANT__SERVICE__HTTP_PORT: '6333',
      QDRANT__SERVICE__GRPC_PORT: '6334',
      QDRANT__STORAGE__STORAGE_PATH: storage,
      QDRANT__STORAGE__SNAPSHOTS_PATH: snapshots,
      QDRANT__TELEMETRY_DISABLED: 'true',
    },
  })
  let output = ''
  let didExit = false
  let spawnError: Error | undefined
  const append = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-8_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.once('error', (error) => { spawnError = error })
  const exitPromise = new Promise<void>((resolve) => child.once('close', () => { didExit = true; resolve() }))

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await qdrantReady(url)) {
      const restoreEnvironment = exposeQdrantUrl(url)
      return {
        url,
        owned: true,
        async stop() {
          try { await stopChild(child, () => didExit, exitPromise) }
          finally { restoreEnvironment() }
        },
      }
    }
    if (spawnError || didExit) break
    await delay(100)
  }

  await stopChild(child, () => didExit, exitPromise)
  const detail = spawnError?.message || output.trim() || '启动超时，未监听 6333 端口'
  throw Object.assign(new Error(`本地 Qdrant 启动失败：${detail}`), { code: 'QDRANT_START_FAILED' })
}

export async function openPathOrThrow(path: string): Promise<void> {
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

/**
 * A development Desktop must not reuse a healthy Service process started from
 * an older backend bundle. Packaged builds keep the durable service lifecycle.
 */
export async function restartDevelopmentLocalService(): Promise<boolean> {
  if (app.isPackaged || !useLocalService) return false
  return stopLocalService(app.getPath('userData'))
}

/**
 * The standalone Service owns storage recovery and Agent activation. Desktop
 * must not construct a second Backend runtime before connecting to it.
 */
export function shouldRecoverStorageInDesktopProcess(localService = useLocalService): boolean {
  return !localService
}

let activeWindow: BrowserWindow | undefined
let onboardingWindow: BrowserWindow | undefined
let onboardingHandoff = false
let composition: any
let cloudSync: ReturnType<typeof createCloudSyncRuntime> | undefined
let qdrant: ManagedQdrant | undefined
let disposeStorageIpc: (() => void) | undefined
let disposeLegacyIpc: (() => void) | undefined
let quitting = false
let exclusiveStorageSession: { id: string; kind: 'git-import' | 'agent-plan'; composition: any; timer: NodeJS.Timeout } | undefined
const selections = new SelectionStore()
const bootstrapPath = () => join(app.getPath('userData'), 'ash-bootstrap.json')
let sharedControlStore: StorageControlStore | undefined
const controlStore = () => sharedControlStore ??= new StorageControlStore(app.getPath('userData'))
const pendingIntents = new Map<string, RelaunchIntent>()
const progressTails = new Map<string, Promise<void>>()

function trusted(event: Electron.IpcMainInvokeEvent, expected: BrowserWindow | undefined): void { if (!expected || event.sender.id !== expected.webContents.id || event.senderFrame !== expected.webContents.mainFrame) throw new Error('Untrusted IPC sender') }
function selectionBinding(event: Electron.IpcMainInvokeEvent, purpose: SelectionPurpose) { const frame = event.senderFrame; if (!frame) throw new Error('Missing IPC sender frame'); return { senderId: event.sender.id, frameId: (frame as any).routingId ?? event.sender.id, origin: new URL(frame.url).origin, purpose } }
async function trackedMigration(id: string, kind: 'volume'|'group', value: string, operation: (operationId: string) => Promise<string>): Promise<void> {
  const store=new BootstrapStore(bootstrapPath()); const before=await store.read(); if (!before) throw new Error('Bootstrap does not exist')
  try { const result=await operation(id); if (result!==id) throw new Error(`Migration operation id mismatch: expected ${id}, got ${result}`); await (progressTails.get(id) ?? Promise.resolve()); const after=await store.read(); if (!after) throw new Error('Committed Bootstrap is missing'); const refs=buildBackupRefs(id,kind,before,after,value); await controlStore().completeOperation(id,refs,{previous:before,current:after}); pendingIntents.set(id,{ schemaVersion:1, operationId:id, phase:'awaiting-new-process-health', attempt:0, previous:before, current:after, backupRefs:refs }) }
  catch(error) { await controlStore().failOperation(id,error).catch(()=>{}); throw error } finally { progressTails.delete(id) }
}

/** Start a durable operation before doing any potentially long-running migration work. */
async function startTrackedMigration(kind: 'volume'|'group', value: string, operation: (operationId: string) => Promise<string>) {
  const id=randomUUID(); await controlStore().startOperation(id,kind)
  const completion=trackedMigration(id,kind,value,operation)
    .then(async()=>{ await controller.relaunchAfterMigration(id) })
    .catch(async(error)=>{ await controlStore().failOperation(id,error).catch(()=>{}); throw error })
  return { operationId:id, completion }
}

let updater: any
function getUpdater(): any { if (app.isPackaged && !updater) { updater = require('electron-updater').autoUpdater; updater.autoDownload = false; updater.on('update-available', (info: any) => activeWindow?.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes })); updater.on('download-progress', (value: any) => activeWindow?.webContents.send('download-progress', { percent: Math.round(value.percent), transferred: value.transferred, total: value.total })); updater.on('update-downloaded', (info: any) => activeWindow?.webContents.send('update-downloaded', { version: info.version })) } return updater }
function registerLegacyIpc(): () => void {
  const names = ['dialog:openDirectory','download-update','install-update','check-for-updates','app:openDataDir','app:resetSystem']
  ipcMain.handle('dialog:openDirectory', async (event) => { trusted(event, activeWindow); const result = await dialog.showOpenDialog(activeWindow!, { properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0] ?? null })
  ipcMain.handle('download-update', async (event) => { trusted(event, activeWindow); const value = getUpdater(); if (!value) return { success: false, error: 'Updates are available only in packaged builds' }; try { await value.downloadUpdate(); return { success: true } } catch (error) { return { success: false, error: (error as Error).message } } })
  ipcMain.handle('install-update', (event) => { trusted(event, activeWindow); getUpdater()?.quitAndInstall(false, true) })
  ipcMain.handle('check-for-updates', async (event) => { trusted(event, activeWindow); const value = getUpdater(); if (!value) return { success: false, error: 'Updates are available only in packaged builds' }; try { const result = await value.checkForUpdates(); return { success: true, updateInfo: result?.updateInfo } } catch (error) { return { success: false, error: (error as Error).message } } })
  ipcMain.handle('app:openDataDir', async (event) => { trusted(event, activeWindow); const bootstrap = await new BootstrapStore(bootstrapPath()).read(); if (!bootstrap?.volumes[0]) return { success: false }; await openPathOrThrow(volumeRoot(bootstrap.volumes[0])); return { success: true } })
  ipcMain.handle('app:resetSystem', (event) => { trusted(event, activeWindow); return { success: false, error: 'Use Storage settings to migrate or remove managed data safely' } })
  return () => { for (const name of names) ipcMain.removeHandler(name) }
}

async function listBackups() {
  const result: Array<{id:string;operationId:string;kind:string;groupId?:string;volumeId?:string;createdAt:string;bytes:number}> = []
  const active=await new BootstrapStore(bootstrapPath()).read(); if(!active) return result
  for (const operation of await controlStore().listOperations()) for (const ref of await trustedBackupRefs(operation,active)) { if (!await pathExists(ref.backupPath)) continue; const inventory=await inventoryTree(ref.backupPath); result.push({ id:`${ref.operationId}--${ref.kind==='group'?ref.groupId:ref.volumeId}`, operationId:ref.operationId, kind:ref.kind, groupId:ref.kind==='group'?ref.groupId:undefined, volumeId:ref.kind==='volume'?ref.volumeId:undefined, createdAt:operation.updatedAt, bytes:inventory.bytes }) }
  return result
}

async function withExclusiveStorage<T>(operation: (value: any) => Promise<T>): Promise<T> {
  if (exclusiveStorageSession) throw Object.assign(new Error('Another storage plan is waiting for confirmation'), { code: 'STORAGE_BUSY' })
  await assertNoActiveJobs()
  await stopLocalService(app.getPath('userData')).catch(() => false)
  const backend = await importEsm('@manta/backend') as BackendModule
  const value = await backend.createBackendStorageComposition(new BootstrapStore(bootstrapPath()), {
    deferAgentRecovery: true,
    onAgentProgress: (progress: unknown) => activeWindow?.webContents.send('storage:agent-progress', progress),
    onProgress: (progress: unknown) => activeWindow?.webContents.send('storage:progress', progress),
  })
  try {
    await value.hub.migrations?.recoverPending()
    await value.activateAgents()
    return await operation(value)
  } finally {
    await value.runtime.close().catch(() => undefined)
    const nextUrl = await createDesktopServiceSessionURL()
    setTimeout(() => { if (activeWindow && !activeWindow.isDestroyed()) void activeWindow.loadURL(nextUrl) }, 250)
  }
}

async function assertNoActiveJobs(): Promise<void> {
  const manta = await createLocalManta({ home: app.getPath('userData'), autoStart: false }).catch(() => undefined)
  if (!manta) return
  const response = await manta.jobs.list({ limit: 200 })
  const active = response.data.filter((job) => ['queued', 'running', 'waiting_for_input', 'retry_scheduled', 'cancelling', 'recovery_required'].includes(job.status))
  if (active.length) throw Object.assign(new Error(`Storage changes require all background Jobs to finish or be cancelled (${active.length} active)`), { code: 'STORAGE_BUSY' })
}

async function openExclusiveStorage(): Promise<any> {
  if (exclusiveStorageSession) throw Object.assign(new Error('Another storage plan is waiting for confirmation'), { code: 'STORAGE_BUSY' })
  await assertNoActiveJobs()
  await stopLocalService(app.getPath('userData')).catch(() => false)
  const backend = await importEsm('@manta/backend') as BackendModule
  const current = await backend.createBackendStorageComposition(new BootstrapStore(bootstrapPath()), {
    deferAgentRecovery: true,
    onAgentProgress: (progress: unknown) => activeWindow?.webContents.send('storage:agent-progress', progress),
    onProgress: (progress: unknown) => activeWindow?.webContents.send('storage:progress', progress),
  })
  await current.hub.migrations?.recoverPending()
  await current.activateAgents()
  return current
}

async function restartServiceRenderer(): Promise<void> {
  const nextUrl = await createDesktopServiceSessionURL()
  setTimeout(() => { if (activeWindow && !activeWindow.isDestroyed()) void activeWindow.loadURL(nextUrl) }, 250)
}

async function closeExclusiveStorageSession(session: NonNullable<typeof exclusiveStorageSession>, restart = true): Promise<void> {
  clearTimeout(session.timer)
  if (exclusiveStorageSession === session) exclusiveStorageSession = undefined
  await session.composition.runtime.close().catch(() => undefined)
  if (restart) await restartServiceRenderer()
}

async function beginExclusiveStorageSession<T>(kind: 'git-import' | 'agent-plan', operation: (current: any) => Promise<T>, sessionId: (value: T) => string): Promise<T> {
  const current = await openExclusiveStorage()
  try {
    const value = await operation(current)
    const id = sessionId(value)
    let session!: NonNullable<typeof exclusiveStorageSession>
    const timer = setTimeout(() => { void closeExclusiveStorageSession(session).catch(() => undefined) }, 5 * 60_000)
    session = { id, kind, composition: current, timer }
    session.timer.unref()
    exclusiveStorageSession = session
    return value
  } catch (error) {
    await current.runtime.close().catch(() => undefined)
    await restartServiceRenderer().catch(() => undefined)
    throw error
  }
}

async function useExclusiveStorageSession<T>(kind: 'git-import' | 'agent-plan', id: string, operation: (current: any) => Promise<T>): Promise<T> {
  const session = exclusiveStorageSession
  if (!session || session.kind !== kind || session.id !== id) throw Object.assign(new Error('Storage plan is unknown, expired, or already used'), { code: 'STORAGE_PLAN_INVALID' })
  try { return await operation(session.composition) }
  finally { await closeExclusiveStorageSession(session) }
}

function startExternalTrackedMigration(kind: 'volume' | 'group', value: string, operation: (composition: any, operationId: string) => Promise<string>) {
  const id = randomUUID()
  const completion = (async () => {
    await controlStore().startOperation(id, kind)
    await stopLocalService(app.getPath('userData')).catch(() => false)
    const backend = await importEsm('@manta/backend') as BackendModule
    const current = await backend.createBackendStorageComposition(new BootstrapStore(bootstrapPath()), {
      deferAgentRecovery: true,
      onProgress: (progress: unknown) => activeWindow?.webContents.send('storage:progress', progress),
    })
    try {
      await current.hub.migrations?.recoverPending()
      await trackedMigration(id, kind, value, (operationId) => operation(current, operationId))
    } finally { await current.runtime.close().catch(() => undefined) }
    await controller.relaunchAfterMigration(id)
  })().catch(async (error) => { await controlStore().failOperation(id, error).catch(() => undefined); throw error })
  return { operationId: id, completion }
}

function installServiceStorageIpc(origin: string): void {
  disposeStorageIpc?.()
  disposeStorageIpc = registerStorageIpc({ ipcMain, trustedOrigin: origin, trustedSenderId: activeWindow?.webContents.id, services: {
    async selectParent(purpose, event) { const result = await dialog.showOpenDialog(activeWindow!, { properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return undefined; return selections.issue(result.filePaths[0], selectionBinding(event, purpose)) },
    async createVolume(name, selectionId, event) {
      const parentPath = selections.consume(selectionId, selectionBinding(event, 'createVolume'))
      return withExclusiveStorage(() => createStorageVolume({ name, parentPath, bootstrap: new BootstrapStore(bootstrapPath()) }))
    },
    async relocateVolume(id, selectionId, event) {
      const target = selections.consume(selectionId, selectionBinding(event, 'migrateVolume'))
      return startExternalTrackedMigration('volume', id, (current, operationId) => current.hub.migrations.relocateVolume(id, target, operationId))
    },
    async moveGroup(group, target) { return startExternalTrackedMigration('group', group, (current, operationId) => current.hub.migrations.moveGroup(group, target, operationId)) },
    async openVolume(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const volume = bootstrap?.volumes.find((item) => item.id === id); if (!volume) throw new Error('Unknown volume'); await openPathOrThrow(volumeRoot(volume)) },
    async deleteBackup(id) {
      await withExclusiveStorage(async () => {
        const active = await new BootstrapStore(bootstrapPath()).read(); if (!active) throw new Error('Storage is not initialized')
        const operations = await controlStore().listOperations(); const matches = (await Promise.all(operations.map(async (item) => (await trustedBackupRefs(item, active)).map((ref) => ({ operation: item, ref }))))).flat().filter(({ ref }) => `${ref.operationId}--${ref.kind === 'group' ? ref.groupId : ref.volumeId}` === id)
        if (matches.length !== 1) throw new Error('Unknown or active backup')
        await assertDeletableBackup(matches[0].ref, matches[0].operation, active); await rm(matches[0].ref.backupPath, { recursive: true, force: true })
      })
    },
    configureGit: (volumeId, config) => withExclusiveStorage(async (current) => { const capability = await current.git.capability(); if (!capability.available) throw Object.assign(new Error(capability.reason ?? 'Git is unavailable'), { code: 'GIT_UNAVAILABLE' }); return current.git.bindVolume({ volumeId, mode: config.mode, remoteUrl: config.mode === 'remote' ? config.remoteUrl : undefined }) }),
    async confirmGitSecrets() { const result = await dialog.showMessageBox(activeWindow!, { type: 'warning', title: 'High-risk Git secrets synchronization', message: 'Sync secrets to Git for this storage volume?', detail: 'Secret values will be committed to Git history.', buttons: ['Cancel', 'I understand, enable'], defaultId: 0, cancelId: 0, noLink: true }); return result.response === 1 },
    setGitSecretsPolicy: (volumeId, includeSecrets) => withExclusiveStorage((current) => current.git.setIncludeSecrets(volumeId, includeSecrets)),
    syncVolume: (volumeId) => withExclusiveStorage((current) => current.git.syncVolume(volumeId)),
    async planGitImport(volumeId) {
      const result = await beginExclusiveStorageSession('git-import', (current) => current.git.planRemoteImport(volumeId), (value: any) => value.sessionId)
      return { volumeId, sessionId: result.sessionId, ...result.plan }
    },
    applyGitImport: (volumeId, input) => useExclusiveStorageSession('git-import', input.sessionId, (current) => current.git.applyRemoteImport(volumeId, input)),
    agentPlanImport: (adapterId, installationId, assetIds, senderId) => beginExclusiveStorageSession('agent-plan', (current) => current.agents.mutations.previewImport(adapterId, installationId, assetIds, senderId), (value: any) => value.planSessionId),
    agentPlanProjection: (adapterId, installationId, assetIds, senderId) => beginExclusiveStorageSession('agent-plan', (current) => current.agents.mutations.previewProjection(adapterId, installationId, assetIds, senderId), (value: any) => value.planSessionId),
    agentApply: (planSessionId, senderId) => useExclusiveStorageSession('agent-plan', planSessionId, (current) => current.agents.mutations.apply(planSessionId, senderId)),
    agentRollback: (operationId) => withExclusiveStorage((current) => current.agents.mutations.rollback(operationId)),
  } })
}

function installMainStorageIpc(origin: string): void {
  const migrations = composition.hub.migrations
  disposeStorageIpc?.(); disposeStorageIpc = registerStorageIpc({ ipcMain, trustedOrigin: origin, trustedSenderId: activeWindow?.webContents.id, services: {
    async selectParent(purpose, event) { const result = await dialog.showOpenDialog(activeWindow!, { properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return undefined; return selections.issue(result.filePaths[0], selectionBinding(event, purpose)) },
    createVolume: (name, selectionId, event) => createStorageVolume({ name, parentPath: selections.consume(selectionId, selectionBinding(event, 'createVolume')), bootstrap: new BootstrapStore(bootstrapPath()) }),
    async relocateVolume(id, selectionId, event) { const target=selections.consume(selectionId, selectionBinding(event, 'migrateVolume')); return startTrackedMigration('volume',id,(operationId)=>migrations.relocateVolume(id,target,operationId)) },
    moveGroup: (group, target) => startTrackedMigration('group',group,(operationId)=>migrations.moveGroup(group,target,operationId)),
    async openVolume(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const volume = bootstrap?.volumes.find((item) => item.id === id); if (!volume) throw new Error('Unknown volume'); await openPathOrThrow(volumeRoot(volume)) },
    async deleteBackup(id) { const active=await new BootstrapStore(bootstrapPath()).read(); if(!active) throw new Error('Storage is not initialized'); const operations=await controlStore().listOperations(); const matches=(await Promise.all(operations.map(async(operation)=>(await trustedBackupRefs(operation,active)).map((ref)=>({operation,ref}))))).flat().filter(({ref})=>`${ref.operationId}--${ref.kind==='group'?ref.groupId:ref.volumeId}`===id); if (matches.length!==1) throw new Error('Unknown or active backup'); await assertDeletableBackup(matches[0].ref,matches[0].operation,active); await rm(matches[0].ref.backupPath,{recursive:true,force:true}) },
    async configureGit(volumeId, config) {
      const capability = await composition.git.capability()
      if (!capability.available) throw Object.assign(new Error(capability.reason ?? 'Git is unavailable'), { code: 'GIT_UNAVAILABLE' })
      if (config.mode === 'remote' && config.authRef) throw Object.assign(new Error('Authenticated Git setup is unavailable in this build. Configure a system Git credential helper, then sync.'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' })
      return composition.git.bindVolume({ volumeId, mode: config.mode, remoteUrl: config.mode === 'remote' ? config.remoteUrl : undefined })
    },
    async confirmGitSecrets(volumeId) {
      const result = await dialog.showMessageBox(activeWindow!, {
        type: 'warning',
        title: 'High-risk Git secrets synchronization',
        message: 'Sync secrets to Git for this storage volume?',
        detail: 'Secret values will be committed to Git. Git history is hard to erase, and a private repository is not absolute safety. Disabling later removes secrets from future snapshots, but cannot erase existing Git history.',
        buttons: ['Cancel', 'I understand, enable'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      return result.response === 1
    },
    setGitSecretsPolicy: (volumeId, includeSecrets) => composition.git.setIncludeSecrets(volumeId, includeSecrets),
    async syncVolume(volumeId) {
      if (!cloudSync) throw Object.assign(new Error('Storage sync runtime is unavailable'), { code: 'SYNC_UNAVAILABLE' })
      return cloudSync.syncNow(volumeId)
    },
    async planGitImport(volumeId) {
      const result = await composition.git.planRemoteImport(volumeId)
      // Keep the cache staging directory and all filesystem details in the
      // main process.  The renderer receives only an opaque one-use session.
      return { volumeId, sessionId: result.sessionId, ...result.plan }
    },
    async applyGitImport(volumeId, input) {
      await composition.git.applyRemoteImport(volumeId, input)
    },
    agentPlanImport: (adapterId, installationId, assetIds, senderId) => composition.agents.mutations.previewImport(adapterId, installationId, assetIds, senderId),
    agentPlanProjection: (adapterId, installationId, assetIds, senderId) => composition.agents.mutations.previewProjection(adapterId, installationId, assetIds, senderId),
    agentApply: (planSessionId, senderId) => composition.agents.mutations.apply(planSessionId, senderId),
    agentRollback: (operationId) => composition.agents.mutations.rollback(operationId),
  } })
}

let disposeOnboarding: (() => void) | undefined
const controller = new DesktopLifecycleController({
  async readBootstrap() { return new BootstrapStore(bootstrapPath()).read() },
  preflightStorage: (...bootstraps) => upgradeBootstrapVolumeDirectories(...bootstraps),
  async recover() { if (!shouldRecoverStorageInDesktopProcess()) return; const bootstrapStore=new BootstrapStore(bootstrapPath()); qdrant ??= await startManagedQdrant(); const before=await bootstrapStore.read(); const journal=before?.pendingMigration; const trackedKind=journal&&trackedRecoveredMigrationKind(journal); const backend = await importEsm('@manta/backend'); composition = await (backend as BackendModule).createBackendStorageComposition(bootstrapStore, { deferAgentRecovery: true, onAgentProgress: (progress: unknown) => activeWindow?.webContents.send('storage:agent-progress', progress), onProgress: (raw: unknown) => { const progress=raw as StorageOperationProgress; if(shouldTrackStorageProgress(progress)){const prior=progressTails.get(progress.operationId) ?? Promise.resolve(); const next=prior.then(()=>controlStore().recordProgress(progress)); progressTails.set(progress.operationId,next.catch(()=>{})); void next.catch(()=>{})} activeWindow?.webContents.send('storage:progress',progress) } }); try { await composition.hub.migrations?.recoverPending(); await composition.activateAgents(); if (journal&&trackedKind) { await controlStore().startOperation(journal.id,trackedKind); const after=await bootstrapStore.read(); if (['planned','quiescing','copying','validating'].includes(journal.phase) || !before?.previous || !after) await controlStore().failOperation(journal.id,new Error('Migration rolled back during startup recovery')); else { const previous={schemaVersion:1 as const,...before.previous}; const value=trackedKind==='volume'?journal.sourceVolumeId:journal.groups[0]; await controlStore().completeOperation(journal.id,buildBackupRefs(journal.id,trackedKind,previous,after,value),{previous,current:after}) } }
    cloudSync = createCloudSyncRuntime({
      volumes: async () => {
        const [bootstrap, bindings] = await Promise.all([bootstrapStore.read(), composition.git.listBindings()])
        const bound = new Set(bindings.map((binding: { volumeId: string }) => binding.volumeId))
        return (bootstrap?.volumes ?? []).filter((volume) => bound.has(volume.id)).map((volume) => ({ volumeId: volume.id, root: volumeRoot(volume) }))
      },
      inspect: inspectFolderHealth,
      sync: (volumeId) => composition.git.syncVolume(volumeId),
      pollIntervalMs: 60_000,
      syncIntervalMs: 15 * 60_000,
    })
  } catch(error) { if (journal&&trackedKind) { await controlStore().startOperation(journal.id,trackedKind); await controlStore().failOperation(journal.id,error) } throw error } },
  async composeStorage() { return useLocalService ? { runtime: undefined, hub: {} } : composition },
  async startServer({ storage, bundledSeedRoot }) { if (useLocalService) return serviceRendererHandle(); const backend = await importEsm('@manta/backend') as BackendModule; await cloudSync?.start(); return backend.startServer({ storage, port: 0, host: '127.0.0.1', bundledSeedRoot, frontendDist: app.isPackaged ? join(process.resourcesPath, 'frontend', 'dist') : join(__dirname, '../../frontend/dist'), isDev: false, storageApi: { readBootstrap: () => new BootstrapStore(bootstrapPath()).read(), inventory: composition.hub.inventory, capacityMetrics: composition.hub.capacityMetrics, volumeHealth: async () => cloudSync?.health() ?? {}, getOperation:(id:string)=>controlStore().getOperation(id), listOperations:()=>controlStore().listOperations(), listBackups, agents: composition.agents.readModel, git: { capability: () => composition.git.capability(), bindings: () => composition.git.listBindings(), status: (volumeId:string) => composition.git.status(volumeId), history: (volumeId:string) => composition.git.history(volumeId) } } }) },
  async openOnboarding() { disposeOnboarding?.(); onboardingHandoff=false; onboardingWindow = createOnboardingWindow(); disposeOnboarding = registerSecureOnboardingIpc({ ipcMain, getWindow: () => onboardingWindow, dialog, app, selections, bootstrapPath: bootstrapPath(), initializeStorage: initializeStorageDirectory, completeInitialization: (onProgress) => controller.continueAfterOnboarding(onProgress), onInitialized() { const completedWindow=onboardingWindow; onboardingHandoff=true; setImmediate(() => { if (completedWindow && onboardingWindow===completedWindow) { disposeOnboarding?.(); disposeOnboarding=undefined; completedWindow.close() } }) }, onboardingUrl: onboardingPageUrl() }); const senderId = onboardingWindow.webContents.id; onboardingWindow.on('closed', () => { const completedHandoff=onboardingHandoff; onboardingHandoff=false; selections.clearSender(senderId); onboardingWindow = undefined; if (!quitting && !completedHandoff) app.quit() }) },
  async openMain(url) { activeWindow = createMainWindow(url, { forwardConsole: !app.isPackaged }); if (useLocalService) installServiceStorageIpc(new URL(url).origin); else installMainStorageIpc(url); disposeLegacyIpc?.(); disposeLegacyIpc = registerLegacyIpc(); const senderId = activeWindow.webContents.id; activeWindow.on('closed', () => { selections.clearSender(senderId); activeWindow = undefined }) },
  async readRelaunchIntent() { const intent=await controlStore().readIntent(); if(!intent)return undefined; const active=await new BootstrapStore(bootstrapPath()).read(); try { if(!active) throw new Error('Bootstrap is missing'); return await validateRelaunchIntent(intent,active,controlStore()) } catch(error) { await controlStore().quarantineIntent(); throw Object.assign(error as Error,{code:'RELAUNCH_INTENT_INVALID'}) } },
  async prepareRelaunch(operationId) { const intent=pendingIntents.get(operationId); if (!intent) throw new Error(`Missing durable relaunch intent for ${operationId}`); try { await controlStore().commitRelaunchIntent(intent) } catch(error) { await restoreRelaunchIntent(intent,bootstrapPath(),controlStore()).catch((rollbackError)=>{ throw new AggregateError([error,rollbackError],'Migration committed but relaunch intent could not be persisted') }); throw error } finally { pendingIntents.delete(operationId) } },
  rollbackRelaunchIntent: (intent) => restoreRelaunchIntent(intent,bootstrapPath(),controlStore()),
  completeRelaunchOperation: (id) => controlStore().markSucceeded(id),
  clearRelaunchIntent: () => controlStore().clearIntent(),
  async resetComposition() { cloudSync?.dispose(); cloudSync=undefined; const current=composition; composition=undefined; if (current?.runtime) await current.runtime.close().catch(()=>{}); if (!useLocalService) { const currentQdrant=qdrant; qdrant=undefined; await currentQdrant?.stop() } },
  quit: () => app.quit(), relaunch: () => app.relaunch(), seedRoot: app.isPackaged ? process.resourcesPath : join(__dirname, '../../..'),
})

export async function runDesktop(): Promise<void> {
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  app.on('second-instance', () => { if (activeWindow?.isMinimized()) activeWindow.restore(); (activeWindow ?? onboardingWindow)?.focus() })
  await app.whenReady()
  await restartDevelopmentLocalService()
  let stopFollowingServiceLog: StopFollowingLog | undefined
  if (!app.isPackaged && useLocalService) {
    const path = serviceLogPath(app.getPath('userData'))
    stopFollowingServiceLog = await followLogFile(path, (chunk) => process.stdout.write(`[service] ${chunk}`))
    process.stdout.write(`[desktop] following service log: ${path}\n`)
  }
  process.stdout.write(`[desktop] starting (${useLocalService ? 'local service' : 'embedded backend'})\n`)
  let result = await controller.start()
  if (result.ok) process.stdout.write('[desktop] window opened\n')
  while (!result.ok) { process.stderr.write(`MANTA_STARTUP_ERROR ${result.error.code}: ${result.error.message}\n`); const choice = await dialog.showMessageBox({ type: 'error', title: 'Manta AI 启动失败', message: `${result.error.code}: ${result.error.message}`, buttons: ['重试', '退出'], defaultId: 0, cancelId: 1 }); if (choice.response !== 0) { app.quit(); break } result = await controller.retry() }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void controller.retry() })
  app.on('before-quit', (event) => { if (quitting) return; event.preventDefault(); quitting = true; void (exclusiveStorageSession ? closeExclusiveStorageSession(exclusiveStorageSession) : Promise.resolve()).then(() => controller.shutdown()).catch((error) => dialog.showErrorBox('关闭失败', (error as Error).message)).finally(() => { stopFollowingServiceLog?.(); disposeStorageIpc?.(); disposeLegacyIpc?.(); disposeOnboarding?.(); app.exit() }) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
