import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BootstrapStore, inventoryTree, volumeRoot } from '@manta/storage-hub'
import { DesktopLifecycleController } from './lifecycle/DesktopLifecycleController'
import { initializeStorage } from './lifecycle/initializeStorage'
import { createStorageVolume } from './lifecycle/createStorageVolume'
import { registerStorageIpc } from './ipc/registerStorageIpc'
import { registerOnboardingIpc as registerSecureOnboardingIpc } from './ipc/registerOnboardingIpc'
import { SelectionStore, type SelectionPurpose } from './ipc/SelectionStore'
import { createMainWindow } from './windows/createMainWindow'
import { createOnboardingWindow, onboardingPageUrl } from './windows/createOnboardingWindow'
import { StorageControlStore, type RelaunchIntent } from './lifecycle/StorageControlStore'
import type { StorageOperationProgress } from '@manta/shared'
import { assertDeletableBackup, buildBackupRefs, pathExists, restoreRelaunchIntent, trustedBackupRefs, validateRelaunchIntent } from './lifecycle/RelaunchRecovery'

interface BackendModule {
  createBackendStorageComposition(store: BootstrapStore, options?: { onProgress?: (progress: unknown) => void }): Promise<any>
  startServer(options: any): Promise<any>
}

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

let activeWindow: BrowserWindow | undefined
let onboardingWindow: BrowserWindow | undefined
let composition: any
let disposeStorageIpc: (() => void) | undefined
let disposeLegacyIpc: (() => void) | undefined
let quitting = false
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
  ipcMain.handle('app:openDataDir', async (event) => { trusted(event, activeWindow); const bootstrap = await new BootstrapStore(bootstrapPath()).read(); if (!bootstrap?.volumes[0]) return { success: false }; await shell.openPath(volumeRoot(bootstrap.volumes[0].parentPath)); return { success: true } })
  ipcMain.handle('app:resetSystem', (event) => { trusted(event, activeWindow); return { success: false, error: 'Use Storage settings to migrate or remove managed data safely' } })
  return () => { for (const name of names) ipcMain.removeHandler(name) }
}

async function listBackups() {
  const result: Array<{id:string;operationId:string;kind:string;groupId?:string;volumeId?:string;createdAt:string;bytes:number}> = []
  const active=await new BootstrapStore(bootstrapPath()).read(); if(!active) return result
  for (const operation of await controlStore().listOperations()) for (const ref of await trustedBackupRefs(operation,active)) { if (!await pathExists(ref.backupPath)) continue; const inventory=await inventoryTree(ref.backupPath); result.push({ id:`${ref.operationId}--${ref.kind==='group'?ref.groupId:ref.volumeId}`, operationId:ref.operationId, kind:ref.kind, groupId:ref.kind==='group'?ref.groupId:undefined, volumeId:ref.kind==='volume'?ref.volumeId:undefined, createdAt:operation.updatedAt, bytes:inventory.bytes }) }
  return result
}

function installMainStorageIpc(origin: string): void {
  const migrations = composition.hub.migrations
  disposeStorageIpc?.(); disposeStorageIpc = registerStorageIpc({ ipcMain, trustedOrigin: origin, trustedSenderId: activeWindow?.webContents.id, services: {
    async selectParent(purpose, event) { const result = await dialog.showOpenDialog(activeWindow!, { properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return undefined; return selections.issue(result.filePaths[0], selectionBinding(event, purpose)) },
    createVolume: (name, selectionId, event) => createStorageVolume({ name, parentPath: selections.consume(selectionId, selectionBinding(event, 'createVolume')), bootstrap: new BootstrapStore(bootstrapPath()) }),
    async relocateVolume(id, selectionId, event) { const target=selections.consume(selectionId, selectionBinding(event, 'migrateVolume')); return startTrackedMigration('volume',id,(operationId)=>migrations.relocateVolume(id,target,operationId)) },
    moveGroup: (group, target) => startTrackedMigration('group',group,(operationId)=>migrations.moveGroup(group,target,operationId)),
    async openVolume(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const volume = bootstrap?.volumes.find((item) => item.id === id); if (!volume) throw new Error('Unknown volume'); await shell.openPath(volumeRoot(volume.parentPath)) },
    async deleteBackup(id) { const active=await new BootstrapStore(bootstrapPath()).read(); if(!active) throw new Error('Storage is not initialized'); const operations=await controlStore().listOperations(); const matches=(await Promise.all(operations.map(async(operation)=>(await trustedBackupRefs(operation,active)).map((ref)=>({operation,ref}))))).flat().filter(({ref})=>`${ref.operationId}--${ref.kind==='group'?ref.groupId:ref.volumeId}`===id); if (matches.length!==1) throw new Error('Unknown or active backup'); await assertDeletableBackup(matches[0].ref,matches[0].operation,active); await rm(matches[0].ref.backupPath,{recursive:true,force:true}) },
    async configureGit(volumeId, config) {
      const operationId = randomUUID()
      const completion = (async () => {
        const capability = await composition.git.capability()
        if (!capability.available) throw Object.assign(new Error(capability.reason ?? 'Git is unavailable'), { code: 'GIT_UNAVAILABLE' })
        await composition.git.bindVolume({ volumeId, mode: config.mode, remoteUrl: config.mode === 'remote' ? config.remoteUrl : undefined, credentialRef: config.mode === 'remote' ? config.authRef : undefined })
      })()
      return { operationId, completion }
    },
  } })
}

let disposeOnboarding: (() => void) | undefined
const controller = new DesktopLifecycleController({
  async readBootstrap() { return new BootstrapStore(bootstrapPath()).read() },
  async recover() { const bootstrapStore=new BootstrapStore(bootstrapPath()); const before=await bootstrapStore.read(); const journal=before?.pendingMigration; const backend = await importEsm('@manta/backend'); composition = await (backend as BackendModule).createBackendStorageComposition(bootstrapStore, { onProgress: (raw: unknown) => { const progress=raw as StorageOperationProgress; const prior=progressTails.get(progress.operationId) ?? Promise.resolve(); const next=prior.then(()=>controlStore().recordProgress(progress)); progressTails.set(progress.operationId,next.catch(()=>{})); void next.catch(()=>{}); activeWindow?.webContents.send('storage:progress',progress) } }); try { await composition.hub.migrations?.recoverPending(); if (journal) { await controlStore().startOperation(journal.id,journal.kind); const after=await bootstrapStore.read(); if (['planned','quiescing','copying','validating'].includes(journal.phase) || !before?.previous || !after) await controlStore().failOperation(journal.id,new Error('Migration rolled back during startup recovery')); else { const previous={schemaVersion:1 as const,...before.previous}; const value=journal.kind==='volume'?journal.sourceVolumeId:journal.groups[0]; await controlStore().completeOperation(journal.id,buildBackupRefs(journal.id,journal.kind,previous,after,value),{previous,current:after}) } } } catch(error) { if (journal) { await controlStore().startOperation(journal.id,journal.kind); await controlStore().failOperation(journal.id,error) } throw error } },
  async composeStorage() { return composition },
  async startServer({ storage, bundledSeedRoot }) { const backend = await importEsm('@manta/backend') as BackendModule; return backend.startServer({ storage, port: 0, host: '127.0.0.1', bundledSeedRoot, frontendDist: app.isPackaged ? join(process.resourcesPath, 'frontend', 'dist') : join(__dirname, '../../frontend/dist'), isDev: false, storageApi: { readBootstrap: () => new BootstrapStore(bootstrapPath()).read(), inventory: composition.hub.inventory, getOperation:(id:string)=>controlStore().getOperation(id), listOperations:()=>controlStore().listOperations(), listBackups, git: { capability: () => composition.git.capability(), bindings: () => composition.git.listBindings(), status: (volumeId:string) => composition.git.status(volumeId), history: (volumeId:string) => composition.git.history(volumeId) } } }) },
  async openOnboarding() { disposeOnboarding?.(); onboardingWindow = createOnboardingWindow(); disposeOnboarding = registerSecureOnboardingIpc({ ipcMain, getWindow: () => onboardingWindow, dialog, app, selections, bootstrapPath: bootstrapPath(), initializeStorage, onboardingUrl: onboardingPageUrl() }); const senderId = onboardingWindow.webContents.id; onboardingWindow.on('closed', () => { selections.clearSender(senderId); onboardingWindow = undefined; if (!quitting) app.quit() }) },
  async openMain(url) { activeWindow = createMainWindow(url); installMainStorageIpc(url); disposeLegacyIpc?.(); disposeLegacyIpc = registerLegacyIpc(); const senderId = activeWindow.webContents.id; activeWindow.on('closed', () => { selections.clearSender(senderId); activeWindow = undefined }) },
  async readRelaunchIntent() { const intent=await controlStore().readIntent(); if(!intent)return undefined; const active=await new BootstrapStore(bootstrapPath()).read(); try { if(!active) throw new Error('Bootstrap is missing'); return await validateRelaunchIntent(intent,active,controlStore()) } catch(error) { await controlStore().quarantineIntent(); throw Object.assign(error as Error,{code:'RELAUNCH_INTENT_INVALID'}) } },
  async prepareRelaunch(operationId) { const intent=pendingIntents.get(operationId); if (!intent) throw new Error(`Missing durable relaunch intent for ${operationId}`); try { await controlStore().commitRelaunchIntent(intent) } catch(error) { await restoreRelaunchIntent(intent,bootstrapPath(),controlStore()).catch((rollbackError)=>{ throw new AggregateError([error,rollbackError],'Migration committed but relaunch intent could not be persisted') }); throw error } finally { pendingIntents.delete(operationId) } },
  rollbackRelaunchIntent: (intent) => restoreRelaunchIntent(intent,bootstrapPath(),controlStore()),
  completeRelaunchOperation: (id) => controlStore().markSucceeded(id),
  clearRelaunchIntent: () => controlStore().clearIntent(),
  async resetComposition() { const current=composition; composition=undefined; if (current?.runtime) await current.runtime.close().catch(()=>{}) },
  quit: () => app.quit(), relaunch: () => app.relaunch(), seedRoot: app.isPackaged ? process.resourcesPath : join(__dirname, '../../..'),
})

export async function runDesktop(): Promise<void> {
  if (!app.requestSingleInstanceLock()) { app.quit(); return }
  app.on('second-instance', () => { if (activeWindow?.isMinimized()) activeWindow.restore(); (activeWindow ?? onboardingWindow)?.focus() })
  await app.whenReady(); let result = await controller.start()
  while (!result.ok) { const choice = await dialog.showMessageBox({ type: 'error', title: 'Manta AI 启动失败', message: `${result.error.code}: ${result.error.message}`, buttons: ['重试', '退出'], defaultId: 0, cancelId: 1 }); if (choice.response !== 0) { app.quit(); break } result = await controller.retry() }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void controller.retry() })
  app.on('before-quit', (event) => { if (quitting) return; event.preventDefault(); quitting = true; void controller.shutdown().catch((error) => dialog.showErrorBox('关闭失败', (error as Error).message)).finally(() => { disposeStorageIpc?.(); disposeLegacyIpc?.(); disposeOnboarding?.(); app.exit() }) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
