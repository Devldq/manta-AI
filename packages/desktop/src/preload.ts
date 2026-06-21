import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 对话框
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // 更新
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (callback: (data: { version: string; releaseNotes?: string }) => void) =>
    ipcRenderer.on('update-available', (_event, data) => callback(data)),
  onDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) =>
    ipcRenderer.on('download-progress', (_event, data) => callback(data)),
  onUpdateDownloaded: (callback: (data: { version: string }) => void) =>
    ipcRenderer.on('update-downloaded', (_event, data) => callback(data)),

  // 应用
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  resetSystem: () => ipcRenderer.invoke('app:resetSystem'),
})
