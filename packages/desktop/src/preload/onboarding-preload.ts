import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mantaOnboarding', {
  state: () => ipcRenderer.invoke('onboarding:state'),
  selectParent: () => ipcRenderer.invoke('onboarding:select-parent'),
  suggestedLocations: () => ipcRenderer.invoke('onboarding:suggested-locations'),
  preview: (selectionId: string) => ipcRenderer.invoke('onboarding:preview', { selectionId }),
  initialize: (selectionId: string) => ipcRenderer.invoke('onboarding:initialize', { selectionId }),
  quit: () => ipcRenderer.invoke('onboarding:quit'),
})
