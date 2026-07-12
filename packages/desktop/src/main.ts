import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BootstrapStore, inventoryTree, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'
import { DesktopLifecycleController } from './lifecycle/DesktopLifecycleController'
import { initializeStorage, previewStorageParent } from './lifecycle/initializeStorage'
import { createStorageVolume } from './lifecycle/createStorageVolume'
import { registerStorageIpc } from './ipc/registerStorageIpc'
import { createMainWindow } from './windows/createMainWindow'
import { createOnboardingWindow } from './windows/createOnboardingWindow'

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
const selections = new Map<string, string>()
const bootstrapPath = () => join(app.getPath('userData'), 'ash-bootstrap.json')

function structuredError(error: unknown) { return { ok: false, error: { code: (error as any).code ?? 'OPERATION_FAILED', message: (error as Error).message } } }
function trusted(event: Electron.IpcMainInvokeEvent, expected: BrowserWindow | undefined): void { if (!expected || event.sender.id !== expected.webContents.id || event.senderFrame !== expected.webContents.mainFrame) throw new Error('Untrusted IPC sender') }
function takeSelection(id: string): string { const path = selections.get(id); if (!path) throw new Error('Directory selection is invalid or expired'); selections.delete(id); return path }
async function restorePreviousBootstrap(): Promise<void> {
  const store = new BootstrapStore(bootstrapPath()); const current = await store.read(); if (!current?.previous) throw new Error('Migration has no previous Bootstrap to restore')
  const previous = { schemaVersion: 1 as const, ...current.previous }
  for (const [group, previousVolumeId] of Object.entries(previous.groupAssignments)) {
    if (current.groupAssignments[group as keyof typeof current.groupAssignments] === previousVolumeId) continue
    const source = previous.volumes.find((volume) => volume.id === previousVolumeId); const target = current.volumes.find((volume) => volume.id === current.groupAssignments[group as keyof typeof current.groupAssignments]); if (!source || !target) continue
    const sourcePath = join(volumeRoot(source.parentPath), group); const backupRoot = join(volumeRoot(source.parentPath), '.ash-backups'); let candidates: Array<{ path: string; time: number }> = []
    try { for (const id of await readdir(backupRoot)) { const path = join(backupRoot, id, group); try { candidates.push({ path, time: (await stat(path)).mtimeMs }) } catch {} } } catch {}
    candidates.sort((a, b) => b.time - a.time); if (!candidates[0]) throw new Error(`Cannot restore backup for ${group}`)
    await rm(join(volumeRoot(target.parentPath), group), { recursive: true, force: true }); await mkdir(volumeRoot(source.parentPath), { recursive: true }); await rename(candidates[0].path, sourcePath)
  }
  const now = new Date().toISOString()
  for (const volume of current.volumes) { const old = previous.volumes.find((item) => item.id === volume.id); if (old && old.parentPath !== volume.parentPath) await writeJsonAtomic(join(volumeRoot(volume.parentPath), 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: 'backup', groups: Object.entries(current.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id), generation: current.generation, createdAt: volume.createdAt, updatedAt: now }) }
  for (const volume of previous.volumes) { const groups = Object.entries(previous.groupAssignments).filter(([, id]) => id === volume.id).map(([id]) => id); await writeJsonAtomic(join(volumeRoot(volume.parentPath), 'ash-volume.json'), { schemaVersion: 1, volumeId: volume.id, name: volume.name, state: groups.length ? 'active' : 'archived', groups, generation: previous.generation, createdAt: volume.createdAt, updatedAt: now }) }
  await store.write(previous)
}

function registerOnboardingIpc(): () => void {
  ipcMain.handle('onboarding:select-parent', async (event) => { trusted(event, onboardingWindow); const result = await dialog.showOpenDialog(onboardingWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Manta AI 数据父目录' }); if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }; const selectionId = randomUUID(); selections.set(selectionId, result.filePaths[0]); return { ok: true, selectionId } })
  ipcMain.handle('onboarding:preview', async (event, input) => { trusted(event, onboardingWindow); const path = selections.get(String(input?.selectionId ?? '')); if (!path) return structuredError(new Error('Directory selection is invalid or expired')); return previewStorageParent(path) })
  ipcMain.handle('onboarding:suggested-locations', async (event) => { trusted(event, onboardingWindow); const values: Array<{ label: string; selectionId: string }> = []; const candidates = [{ label: '用户文件夹', path: app.getPath('home') }, { label: 'iCloud Drive', path: process.platform === 'darwin' ? join(app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs') : process.env.ICLOUD_DRIVE }]; for (const item of candidates) { if (!item.path) continue; try { await access(item.path); const selectionId = randomUUID(); selections.set(selectionId, item.path); values.push({ label: item.label, selectionId }) } catch {} } return { ok: true, locations: values } })
  ipcMain.handle('onboarding:initialize', async (event, input) => { trusted(event, onboardingWindow); try { const path = takeSelection(String(input?.selectionId ?? '')); await initializeStorage({ parentPath: path, bootstrapPath: bootstrapPath() }); app.relaunch(); app.quit(); return { ok: true } } catch (error) { return structuredError(error) } })
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
  const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const result: Array<{id:string;volumeId:string;createdAt:string;bytes:number}> = []
  for (const volume of bootstrap?.volumes ?? []) {
    const root = join(volumeRoot(volume.parentPath), '.ash-backups'); let names: string[] = []; try { names = await readdir(root) } catch { continue }
    for (const id of names) { const path = join(root, id); const info = await stat(path); const inventory = await inventoryTree(path); result.push({ id, volumeId: volume.id, createdAt: info.birthtime.toISOString(), bytes: inventory.bytes }) }
  } return result
}

function installMainStorageIpc(origin: string): void {
  const migrations = composition.hub.migrations
  disposeStorageIpc?.(); disposeStorageIpc = registerStorageIpc({ ipcMain, trustedOrigin: origin, trustedSenderId: activeWindow?.webContents.id, services: {
    async selectParent() { const result = await dialog.showOpenDialog(activeWindow!, { properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return undefined; const id = randomUUID(); selections.set(id, result.filePaths[0]); return id },
    createVolume: (name, selectionId) => createStorageVolume({ name, parentPath: takeSelection(selectionId), bootstrap: new BootstrapStore(bootstrapPath()) }),
    relocateVolume: (id, selectionId) => controller.migrateAndRelaunch(() => migrations.relocateVolume(id, takeSelection(selectionId)), restorePreviousBootstrap),
    moveGroup: (group, target) => controller.migrateAndRelaunch(() => migrations.moveGroup(group, target), restorePreviousBootstrap),
    async openVolume(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const volume = bootstrap?.volumes.find((item) => item.id === id); if (!volume) throw new Error('Unknown volume'); await shell.openPath(volumeRoot(volume.parentPath)) },
    async deleteBackup(id) { const bootstrap = await new BootstrapStore(bootstrapPath()).read(); const matches = (bootstrap?.volumes ?? []).map((v) => join(volumeRoot(v.parentPath), '.ash-backups', id)); for (const path of matches) await rm(path, { recursive: true, force: true }) },
  } })
}

let disposeOnboarding: (() => void) | undefined
const controller = new DesktopLifecycleController({
  async readBootstrap() { return new BootstrapStore(bootstrapPath()).read() },
  async recover() { const backend = await importEsm('@manta/backend'); composition = await (backend as BackendModule).createBackendStorageComposition(new BootstrapStore(bootstrapPath()), { onProgress: (progress: unknown) => activeWindow?.webContents.send('storage:progress', progress) }); await composition.hub.migrations?.recoverPending() },
  async composeStorage() { return composition },
  async startServer({ storage, bundledSeedRoot }) { const backend = await importEsm('@manta/backend') as BackendModule; return backend.startServer({ storage, port: 0, host: '127.0.0.1', bundledSeedRoot, frontendDist: app.isPackaged ? join(process.resourcesPath, 'frontend', 'dist') : join(__dirname, '../../frontend/dist'), isDev: false, storageApi: { readBootstrap: () => new BootstrapStore(bootstrapPath()).read(), inventory: composition.hub.inventory, listBackups } }) },
  async openOnboarding() { disposeOnboarding?.(); disposeOnboarding = registerOnboardingIpc(); onboardingWindow = createOnboardingWindow(); onboardingWindow.on('closed', () => { onboardingWindow = undefined; if (!quitting) app.quit() }) },
  async openMain(url) { activeWindow = createMainWindow(url); installMainStorageIpc(url); disposeLegacyIpc?.(); disposeLegacyIpc = registerLegacyIpc(); activeWindow.on('closed', () => { activeWindow = undefined }) },
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

if (require.main === module) void runDesktop()
