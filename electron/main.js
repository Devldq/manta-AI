// Electron 主进程 - 极简版本 + 自动更新
const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow = null;

// 配置自动更新（仅生产环境）
if (!isDev) {
  // 配置更新源（GitHub Releases）
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Devldq',
    repo: 'arm-claw',
  });

  // 关闭自动下载（手动控制）
  autoUpdater.autoDownload = false;
  
  // 更新事件监听
  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('✅ Update available:', info.version);
    
    // 通知渲染进程有新版本
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('✅ Already on latest version:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('❌ Update error:', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    console.log(`📥 Downloading: ${percent}%`);
    
    // 通知渲染进程下载进度
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', {
        percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded:', info.version);
    
    // 通知渲染进程下载完成
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version,
      });
    }
  });
}

// IPC 处理：打开文件夹选择对话框
const { dialog } = require('electron');
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择插件目录',
    buttonLabel: '选择此文件夹',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// IPC 处理：开始下载更新
ipcMain.handle('download-update', async () => {
  if (!isDev) {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('Download failed:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Dev mode' };
});

// IPC 处理：安装更新并重启
ipcMain.handle('install-update', () => {
  if (!isDev) {
    autoUpdater.quitAndInstall(false, true);
  }
});

// IPC 处理：检查更新
ipcMain.handle('check-for-updates', async () => {
  if (!isDev) {
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateInfo: result?.updateInfo,
      };
    } catch (error) {
      console.error('Check failed:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Dev mode' };
});

// 创建窗口
function createWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // 开发模式：连接到 Next.js dev server
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式：启动内置的 Next.js 服务器
    const port = 3000;
    mainWindow.loadURL(`http://localhost:${port}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 生产模式：在 Electron 进程中直接启动 Next.js
if (!isDev) {
  app.whenReady().then(async () => {
    try {
      // 直接 require Next.js（不使用 standalone）
      const next = require('next');
      const nextApp = next({
        dev: false,
        dir: app.getAppPath(),
        conf: {
          distDir: '.next',
        },
      });

      await nextApp.prepare();
      
      // 获取请求处理器
      const handle = nextApp.getRequestHandler();
      
      // 创建 HTTP 服务器
      const http = require('http');
      const server = http.createServer((req, res) => {
        handle(req, res);
      });

      // 启动服务器
      const port = 3000;
      server.listen(port, 'localhost', () => {
        console.log(`✅ Next.js server ready on http://localhost:${port}`);
        createWindow();
        
        // 启动后5秒检查更新
        setTimeout(() => {
          autoUpdater.checkForUpdates();
        }, 5000);
      });

      // 清理
      app.on('before-quit', () => {
        server.close();
      });

    } catch (error) {
      console.error('❌ Failed to start Next.js:', error);
      
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Failed to start',
        `Error: ${error.message}`
      );
      
      app.quit();
    }
  });
} else {
  // 开发模式：直接创建窗口
  app.whenReady().then(createWindow);
}

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 窗口管理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
