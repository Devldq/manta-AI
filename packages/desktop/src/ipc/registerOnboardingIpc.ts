import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { App, BrowserWindow, Dialog, IpcMain, IpcMainInvokeEvent } from 'electron'
import { BootstrapStore } from '@manta/storage-hub'
import type { SelectionPurpose } from './SelectionStore'
import { SelectionStore } from './SelectionStore'

export interface OnboardingIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  getWindow(): BrowserWindow | undefined
  dialog: Pick<Dialog, 'showOpenDialog'>
  app: Pick<App, 'getPath' | 'quit' | 'relaunch'>
  selections: SelectionStore
  bootstrapPath: string
  initializeStorage(input: { parentPath: string; bootstrapPath: string }): Promise<unknown>
  previewStorageParent(parentPath: string): unknown
}

function trusted(event: IpcMainInvokeEvent, expected: BrowserWindow | undefined): void {
  if (!expected || event.sender.id !== expected.webContents.id || event.senderFrame !== expected.webContents.mainFrame) throw new Error('Untrusted IPC sender')
}

function selectionBinding(event: IpcMainInvokeEvent, purpose: SelectionPurpose) {
  const frame = event.senderFrame
  if (!frame) throw new Error('Missing IPC sender frame')
  return { senderId: event.sender.id, frameId: frame.routingId ?? event.sender.id, origin: new URL(frame.url).origin, purpose }
}

function structuredError(error: unknown) { return { ok: false, error: { code: (error as any).code ?? 'OPERATION_FAILED', message: (error as Error).message } } }

/** Privileged first-run surface. Every call is pinned to the onboarding main frame. */
export function registerOnboardingIpc(deps: OnboardingIpcDependencies): () => void {
  const window = () => deps.getWindow()
  deps.ipcMain.handle('onboarding:state', async (event) => {
    trusted(event, window())
    const initialized = Boolean(await new BootstrapStore(deps.bootstrapPath).read())
    return { ok: true, initialized, needsSelection: !initialized }
  })
  deps.ipcMain.handle('onboarding:select-parent', async (event) => {
    const target = window(); trusted(event, target)
    const result = await deps.dialog.showOpenDialog(target!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Manta AI 数据父目录' })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, selectionId: deps.selections.issue(result.filePaths[0], selectionBinding(event, 'initialization')) }
  })
  deps.ipcMain.handle('onboarding:preview', async (event, input) => {
    trusted(event, window())
    try { return deps.previewStorageParent(deps.selections.peek(String(input?.selectionId ?? ''), selectionBinding(event, 'initialization'))) } catch (error) { return structuredError(error) }
  })
  deps.ipcMain.handle('onboarding:suggested-locations', async (event) => {
    trusted(event, window())
    const values: Array<{ label: string; selectionId: string }> = []
    const candidates = [{ label: '用户文件夹', path: deps.app.getPath('home') }, { label: 'iCloud Drive', path: process.platform === 'darwin' ? join(deps.app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs') : process.env.ICLOUD_DRIVE }]
    for (const item of candidates) {
      if (!item.path) continue
      try { await access(item.path); values.push({ label: item.label, selectionId: deps.selections.issue(item.path, selectionBinding(event, 'initialization')) }) } catch { /* unavailable cloud location */ }
    }
    return { ok: true, locations: values }
  })
  deps.ipcMain.handle('onboarding:initialize', async (event, input) => {
    trusted(event, window())
    try {
      const path = deps.selections.consume(String(input?.selectionId ?? ''), selectionBinding(event, 'initialization'))
      await deps.initializeStorage({ parentPath: path, bootstrapPath: deps.bootstrapPath })
      deps.app.relaunch(); deps.app.quit()
      return { ok: true }
    } catch (error) { return structuredError(error) }
  })
  deps.ipcMain.handle('onboarding:quit', (event) => { trusted(event, window()); deps.app.quit() })
  return () => { for (const name of ['onboarding:state', 'onboarding:select-parent', 'onboarding:suggested-locations', 'onboarding:preview', 'onboarding:initialize', 'onboarding:quit']) deps.ipcMain.removeHandler(name) }
}
