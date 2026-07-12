import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BootstrapStore, inventoryTree, volumeRoot } from '@manta/storage-hub'
import { DesktopLifecycleController } from './lifecycle/DesktopLifecycleController'
import { initializeStorage, previewStorageParent } from './lifecycle/initializeStorage'
import { createStorageVolume } from './lifecycle/createStorageVolume'
import { registerStorageIpc } from './ipc/registerStorageIpc'
import { SelectionStore, type SelectionPurpose } from './ipc/SelectionStore'
import { createMainWindow } from './windows/createMainWindow'
import { createOnboardingWindow } from './windows/createOnboardingWindow'
import { StorageControlStore, type RelaunchIntent } from './lifecycle/StorageControlStore'
import type { StorageOperationProgress } from '@manta/shared'
import { buildBackupRefs, pathExists, restoreRelaunchIntent, trustedBackupRefs } from './lifecycle/RelaunchRecovery'

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
let activeOperationId: string | undefined
let progressTail: Promise<void> = Promise.resolve()

function structuredError(error: unknown) { return { ok: false, error: { code: (error as any).code ?? 'OPERATION_FAILED', message: (error as Error).message } } }
function trusted(event: Electron.IpcMainInvokeEvent, expected: BrowserWindow | undefined): void { if (!expected || event.sender.id !== expected.webContents.id || event.senderFrame !== expected.webContents.mainFrame) throw new Error('Untrusted IPC sender') }
function selectionBinding(event: Electron.IpcMainInvokeEvent, purpose: SelectionPurpose) { const frame = event.senderFrame; if (!frame) throw new Error('Missing IPC sender frame'); return { senderId: event.sender.id, frameId: (frame as any).routingId ?? event.sender.id, origin: new URL(frame.url).origin, purpose } }
async function trackedMigration(kind: 'volume'|'group', value: string, operation: () => Promise<string>): Promise<string> {
  const store=new BootstrapStore(bootstrapPath()); const before=await store.read(); if (!before) throw new Error('Bootstrap does not exist')
  try { const id=await operation(); await progressTail; await controlStore().startOperation(id,kind); const after=await store.read(); if (!after) throw new Error('Committed Bootstrap is missing'); const refs=buildBackupRefs(id,kind,before,after,value); await controlStore().completeOperation(id,refs,{previous:before,current:after}); pendingIntents.set(id,{ schemaVersion:1, operationId:id, phase:'awaiting-new-process-health', attempt:0, previous:before, current:after, backupRefs:refs }); return id }
  catch(error) { if (activeOperationId) await controlStore().failOperation(activeOperationId,error).catch(()=>{}); throw error } finally { activeOperationId=undefined }
}

function registerOnboardingIpc(): () => void {
  ipcMain.handle('onboarding:select-parent', async (event) => { trusted(event, onboardingWindow); const result = await dialog.showOpenDialog(onboardingWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Manta AI 数据父目录' }); if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }; return { ok: true, selectionId: selections.issue(result.filePaths[0], selectionBinding(event, 'initialization')) } })
  ipcMain.handle('onboarding:preview', async (event, input) => { trusted(event, onboardingWindow); try { return previewStorageParent(selections.peek(String(input?.selectionId ?? ''), selectionBinding(event, 'initialization'))) } catch (error) { return structuredError(error) } })
  ipcMain.handle('onboarding:suggested-locations', async (event) => { trusted(event, onboardingWindow); const values: Array<{ label: string; selectionId: string }> = []; const candidates = [{ label: '用户文件夹', path: app.getPath('home') }, { label: 'iCloud Drive', path: process.platform === 'darwin' ? join(app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs') : process.env.ICLOUD_DRIVE }]; for (const item of candidates) { if (!item.path) continue; try { await access(item.path); values.push({ label: item.label, selectionId: selections.issue(item.path, selectionBinding(event, 'initialization')) }) } catch {} } return { ok: true, locations: values } })
  ipcMain.handle('onboarding:initialize', async (event, input) => { trusted(event, onboardingWindow); try { const path = selections.consume(String(input?.selectionId ?? ''), selectionBinding(event, 'initialization')); await initializeStorage({ parentPath: path, bootstrapPath: bootstrapPath() }); app.relaunch(); app.quit(); return { ok: true } } catch (error) { return structuredError(error) } })
  ipcMain.handle('onboarding:quit', (event) => { trusted(event, onboardingWindow); app.quit() })
  return () => { for (const name of ['onboarding:select-parent','onboarding:suggested-locations','onboarding:preview','onboarding:initialize','onboarding:quit']) ipcMain.removeHandler(name) }
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
    relocateVolume: (id, selectionId, event) => controller.migrateAndRelaunch(() => trackedMigration('volume',id,()=>migrations.relocateVolume(id, selections.consume(selectionId, selectionBinding(event, 'migrateVolume'))))),
    moveGroup: (group, target) => controller.migrateAndRelaunch(() => trackedMigration('group',group,()=>migrations.moveGroup(group,target))),
    async openVolume(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const volume = bootstrap?.volumes.find((item) => item.id === id); if (!volume) throw new Error('Unknown volume'); await shell.openPath(volumeRoot(volume.parentPath)) },
    async deleteBackup(id) { const active=await new BootstrapStore(bootstrapPath()).read(); if(!active) throw new Error('Storage is not initialized'); const refs=(await Promise.all((await controlStore().listOperations()).map((operation)=>trustedBackupRefs(operation,active)))).flat().filter((ref)=>`${ref.operationId}--${ref.kind==='group'?ref.groupId:ref.volumeId}`===id); if (refs.length!==1) throw new Error('Unknown or active backup'); await rm(refs[0].backupPath,{recursive:true,force:true}) },
  } })
}

let disposeOnboarding: (() => void) | undefined
const controller = new DesktopLifecycleController({
  async readBootstrap() { return new BootstrapStore(bootstrapPath()).read() },
  async recover() { const bootstrapStore=new BootstrapStore(bootstrapPath()); const before=await bootstrapStore.read(); const journal=before?.pendingMigration; const backend = await importEsm('@manta/backend'); composition = await (backend as BackendModule).createBackendStorageComposition(bootstrapStore, { onProgress: (raw: unknown) => { const progress=raw as StorageOperationProgress; activeOperationId=progress.operationId; progressTail=progressTail.then(()=>controlStore().recordProgress(progress)).catch(()=>{}); activeWindow?.webContents.send('storage:progress',progress) } }); try { await composition.hub.migrations?.recoverPending(); if (journal) { await controlStore().startOperation(journal.id,journal.kind); const after=await bootstrapStore.read(); if (['planned','quiescing','copying','validating'].includes(journal.phase) || !before?.previous || !after) await controlStore().failOperation(journal.id,new Error('Migration rolled back during startup recovery')); else { const previous={schemaVersion:1 as const,...before.previous}; const value=journal.kind==='volume'?journal.sourceVolumeId:journal.groups[0]; await controlStore().completeOperation(journal.id,buildBackupRefs(journal.id,journal.kind,previous,after,value),{previous,current:after}) } } } catch(error) { if (journal) { await controlStore().startOperation(journal.id,journal.kind); await controlStore().failOperation(journal.id,error) } throw error } },
  async composeStorage() { return composition },
  async startServer({ storage, bundledSeedRoot }) { const backend = await importEsm('@manta/backend') as BackendModule; return backend.startServer({ storage, port: 0, host: '127.0.0.1', bundledSeedRoot, frontendDist: app.isPackaged ? join(process.resourcesPath, 'frontend', 'dist') : join(__dirname, '../../frontend/dist'), isDev: false, storageApi: { readBootstrap: () => new BootstrapStore(bootstrapPath()).read(), inventory: composition.hub.inventory, getOperation:(id:string)=>controlStore().getOperation(id), listBackups } }) },
  async openOnboarding() { disposeOnboarding?.(); disposeOnboarding = registerOnboardingIpc(); onboardingWindow = createOnboardingWindow(); const senderId = onboardingWindow.webContents.id; onboardingWindow.on('closed', () => { selections.clearSender(senderId); onboardingWindow = undefined; if (!quitting) app.quit() }) },
  async openMain(url) { activeWindow = createMainWindow(url); installMainStorageIpc(url); disposeLegacyIpc?.(); disposeLegacyIpc = registerLegacyIpc(); const senderId = activeWindow.webContents.id; activeWindow.on('closed', () => { selections.clearSender(senderId); activeWindow = undefined }) },
  readRelaunchIntent: () => controlStore().readIntent(),
  async prepareRelaunch(operationId) { const intent=pendingIntents.get(operationId); if (!intent) throw new Error(`Missing durable relaunch intent for ${operationId}`); try { await controlStore().writeIntent(intent) } catch(error) { await restoreRelaunchIntent(intent,bootstrapPath(),controlStore()).catch((rollbackError)=>{ throw new AggregateError([error,rollbackError],'Migration committed but relaunch intent could not be persisted') }); throw error } finally { pendingIntents.delete(operationId) } },
  rollbackRelaunchIntent: (intent) => restoreRelaunchIntent(intent,bootstrapPath(),controlStore()),
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
