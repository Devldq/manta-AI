// AI start: Preload 脚本 - 暴露安全的 Electron API 给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

// AI: 暴露安全的 API 给渲染进程（通过 window.electronAPI 访问）
contextBridge.exposeInMainWorld('electronAPI', {
  // AI: 文件系统操作（示例，可根据需要扩展）
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', path, data),
  
  // AI: 应用信息
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  
  // AI: 窗口控制
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // AI: 文件夹选择对话框（用于插件安装）
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // AI: 数据管理
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  resetSystem: () => ipcRenderer.invoke('app:resetSystem'),

  // AI start: 自动更新相关 API
  // 检查更新
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  // 下载更新
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  // 安装更新并重启
  installUpdate: () => ipcRenderer.invoke('install-update'),
  // 监听更新事件
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, data) => callback(data)),
  // 移除事件监听
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  // AI end: 自动更新相关 API
});
// AI end: Preload 脚本
