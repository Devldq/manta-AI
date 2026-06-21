import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null
let backendPort: number | null = null

// ─── 懒加载 electron-updater ────────────────────────────────
let _autoUpdater: any = null

function getAutoUpdater(): any {
  if (!_autoUpdater) {
    try {
      _autoUpdater = require('electron-updater').autoUpdater
    } catch (e: any) {
      console.warn('electron-updater 加载失败:', e.message)
    }
  }
  return _autoUpdater
}

// ─── 配置自动更新（仅生产环境） ─────────────────────────────
if (!isDev) {
  const updater = getAutoUpdater()
  if (updater) {
    updater.setFeedURL({
      provider: 'github',
      owner: 'Devldq',
      repo: 'arm-claw',
    })
    updater.autoDownload = false

    updater.on('checking-for-update', () => console.log('Checking for updates...'))
    updater.on('update-available', (info: any) => {
      console.log('Update available:', info.version)
      mainWindow?.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes })
    })
    updater.on('update-not-available', (info: any) => console.log('Already on latest:', info.version))
    updater.on('error', (err: any) => console.error('Update error:', err))
    updater.on('download-progress', (progressObj: any) => {
      const percent = Math.round(progressObj.percent)
      console.log(`Downloading: ${percent}%`)
      mainWindow?.webContents.send('download-progress', { percent, transferred: progressObj.transferred, total: progressObj.total })
    })
    updater.on('update-downloaded', (info: any) => {
      console.log('Update downloaded:', info.version)
      mainWindow?.webContents.send('update-downloaded', { version: info.version })
    })
  }
}

// ─── IPC 处理器 ─────────────────────────────────────────────

// 打开文件夹选择对话框
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: '选择插件目录',
    buttonLabel: '选择此文件夹',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// 开始下载更新
ipcMain.handle('download-update', async () => {
  if (!isDev) {
    const updater = getAutoUpdater()
    if (updater) {
      try {
        await updater.downloadUpdate()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  }
  return { success: false, error: 'Dev mode' }
})

// 安装更新并重启
ipcMain.handle('install-update', () => {
  if (!isDev) {
    const updater = getAutoUpdater()
    if (updater) updater.quitAndInstall(false, true)
  }
})

// 检查更新
ipcMain.handle('check-for-updates', async () => {
  if (!isDev) {
    const updater = getAutoUpdater()
    if (updater) {
      try {
        const result = await updater.checkForUpdates()
        return { success: true, updateInfo: result?.updateInfo }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  }
  return { success: false, error: 'Dev mode' }
})

// 打开数据目录
ipcMain.handle('app:openDataDir', async () => {
  const dataDir = path.join(os.homedir(), '.manta-data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  await shell.openPath(dataDir)
  return { success: true }
})

// 重置系统
ipcMain.handle('app:resetSystem', async () => {
  const dataDir = path.join(os.homedir(), '.manta-data')
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['取消', '确认重置'],
    defaultId: 0,
    cancelId: 0,
    title: '重置系统',
    message: '确定要重置系统吗？',
    detail: '这将删除所有本地数据（~/.manta-data），包括会话记录、LLM 配置、插件设置、记忆等。此操作不可撤销。',
  })
  if (result.response !== 1) return { success: false, canceled: true }
  try {
    if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// ─── 创建窗口 ───────────────────────────────────────────────
function createWindow(): void {
  if (mainWindow) return

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // 生产模式：使用嵌入式 Fastify 服务器
    if (backendPort) {
      mainWindow.loadURL(`http://localhost:${backendPort}`)
    } else {
      console.error('Backend server port not available')
      dialog.showErrorBox('启动失败', '无法启动后端服务器')
      app.quit()
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── 启动 ───────────────────────────────────────────────────
if (!isDev) {
  app.whenReady().then(async () => {
    try {
      // 启动嵌入式 Fastify 后端
      const { startServer } = await import('@manta/backend/dist/server')
      // Fastify 后端会自行监听端口
      // 等待服务器就绪后创建窗口
      setTimeout(() => {
        createWindow()
        setTimeout(() => {
          const updater = getAutoUpdater()
          if (updater) updater.checkForUpdates()
        }, 5000)
      }, 2000)
    } catch (error: any) {
      console.error('Failed to start backend:', error)
      dialog.showErrorBox('启动失败', `Error: ${error.message}`)
      app.quit()
    }
  })
} else {
  app.whenReady().then(createWindow)
}

// ─── 单实例锁 ───────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ─── 窗口管理 ───────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
