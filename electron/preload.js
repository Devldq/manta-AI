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
});
// AI end: Preload 脚本
