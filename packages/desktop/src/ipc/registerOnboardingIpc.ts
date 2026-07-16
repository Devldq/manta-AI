import type { App, BrowserWindow, Dialog, IpcMain, IpcMainInvokeEvent } from 'electron'
import { BootstrapStore } from '@manta/storage-hub'
import type { SelectionPurpose } from './SelectionStore'
import { SelectionStore } from './SelectionStore'
import type { OnboardingProgressReporter } from '../onboarding/progress-contract'

export interface OnboardingIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  getWindow(): BrowserWindow | undefined
  dialog: Pick<Dialog, 'showOpenDialog'>
  app: Pick<App, 'quit'>
  selections: SelectionStore
  bootstrapPath: string
  initializeStorage(input: { parentPath: string; bootstrapPath: string; onProgress?: OnboardingProgressReporter }): Promise<unknown>
  completeInitialization(onProgress: OnboardingProgressReporter): Promise<{ ok: true } | { ok: false; error: { code: string; message: string; retryable?: boolean } }>
  onInitialized(): void
  /** Exact file URL loaded by the isolated onboarding BrowserWindow. */
  onboardingUrl: string
}

function trusted(event: IpcMainInvokeEvent, expected: BrowserWindow | undefined, onboardingUrl: string): void {
  const canonical = new URL(onboardingUrl)
  if (
    canonical.protocol !== 'file:' ||
    !expected ||
    event.sender.id !== expected.webContents.id ||
    event.senderFrame !== expected.webContents.mainFrame ||
    event.senderFrame?.url !== canonical.href ||
    expected.webContents.mainFrame.url !== canonical.href
  ) throw new Error('Untrusted IPC sender')
}

function selectionBinding(event: IpcMainInvokeEvent, purpose: SelectionPurpose) {
  const frame = event.senderFrame
  if (!frame) throw new Error('Missing IPC sender frame')
  return { senderId: event.sender.id, frameId: frame.routingId ?? event.sender.id, origin: new URL(frame.url).origin, purpose }
}

function structuredError(error: unknown) {
  return { ok: false, error: { code: (error as any).code ?? 'OPERATION_FAILED', message: (error as Error).message } }
}

/** Privileged first-run surface. Every call is pinned to the canonical onboarding main frame. */
export function registerOnboardingIpc(deps: OnboardingIpcDependencies): () => void {
  const window = () => deps.getWindow()
  let selectedParentPath: string | undefined
  deps.ipcMain.handle('onboarding:state', async (event) => {
    trusted(event, window(), deps.onboardingUrl)
    const initialized = Boolean(await new BootstrapStore(deps.bootstrapPath).read())
    return { ok: true, initialized, needsSelection: !initialized }
  })
  deps.ipcMain.handle('onboarding:select-parent', async (event) => {
    const target = window()
    trusted(event, target, deps.onboardingUrl)
    const result = await deps.dialog.showOpenDialog(target!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择 Manta AI 数据父目录',
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    selectedParentPath = undefined
    return { ok: true, selectionId: deps.selections.issue(result.filePaths[0], selectionBinding(event, 'initialization')) }
  })
  deps.ipcMain.handle('onboarding:initialize', async (event, input) => {
    const target = window()
    trusted(event, target, deps.onboardingUrl)
    try {
      selectedParentPath ??= deps.selections.consume(String(input?.selectionId ?? ''), selectionBinding(event, 'initialization'))
      const canonicalUrl = new URL(deps.onboardingUrl).href
      const onProgress: OnboardingProgressReporter = (progress) => {
        if (!target || target.webContents.isDestroyed() || target.webContents.mainFrame.url !== canonicalUrl) return
        target.webContents.send('onboarding:progress', progress)
      }
      await deps.initializeStorage({ parentPath: selectedParentPath, bootstrapPath: deps.bootstrapPath, onProgress })
      const result = await deps.completeInitialization(onProgress)
      if (!result.ok) return result
      deps.onInitialized()
      return result
    } catch (error) {
      return structuredError(error)
    }
  })
  deps.ipcMain.handle('onboarding:quit', (event) => {
    trusted(event, window(), deps.onboardingUrl)
    deps.app.quit()
  })
  return () => {
    selectedParentPath = undefined
    for (const name of ['onboarding:state', 'onboarding:select-parent', 'onboarding:initialize', 'onboarding:quit']) deps.ipcMain.removeHandler(name)
  }
}
