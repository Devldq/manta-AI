import { contextBridge, ipcRenderer } from 'electron'
import { createStorageRendererBridge } from '../ipc/storageRendererBridge'

contextBridge.exposeInMainWorld('mantaDesktop', { storage: createStorageRendererBridge(ipcRenderer) })
const subscription = (channel: string, callback: (data: any) => void) => { const listener = (_event: unknown, data: any) => callback(data); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener) }
contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'), openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'), installUpdate: () => ipcRenderer.invoke('install-update'), checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback: (data: any) => void) => subscription('update-available', callback), onDownloadProgress: (callback: (data: any) => void) => subscription('download-progress', callback), onUpdateDownloaded: (callback: (data: any) => void) => subscription('update-downloaded', callback),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'), resetSystem: () => ipcRenderer.invoke('app:resetSystem'),
})
