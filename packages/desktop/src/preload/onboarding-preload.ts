import { contextBridge, ipcRenderer } from 'electron'
import { isOnboardingProgressEvent, type OnboardingProgressEvent } from '../onboarding/progress-contract'

contextBridge.exposeInMainWorld('mantaOnboarding', {
  state: () => ipcRenderer.invoke('onboarding:state'),
  selectParent: () => ipcRenderer.invoke('onboarding:select-parent'),
  initialize: (selectionId: string) => ipcRenderer.invoke('onboarding:initialize', { selectionId }),
  quit: () => ipcRenderer.invoke('onboarding:quit'),
  onProgress: (listener: (event: OnboardingProgressEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isOnboardingProgressEvent(value)) listener(value)
    }
    ipcRenderer.on('onboarding:progress', wrapped)
    return () => ipcRenderer.removeListener('onboarding:progress', wrapped)
  },
})
