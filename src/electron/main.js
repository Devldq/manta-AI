// Electron 主进程 - 极简版本 + 自动更新
// 用 try-catch 包裹全部逻辑，防止 electron-builder 静态分析时因非 Electron 环境崩溃
try {
  const { app, BrowserWindow, ipcMain, dialog } = require('electron');
  const path = require('path');
  const http = require('http');

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  let mainWindow = null;
  let _autoUpdater = null;
  let nextServerPort = null; // 动态端口

  // 懒加载 electron-updater（仅在真实 Electron 运行时初始化，避免构建时崩溃）
  function getAutoUpdater() {
    if (!_autoUpdater) {
      try {
        _autoUpdater = require('electron-updater').autoUpdater;
      } catch (e) {
        console.warn('electron-updater 加载失败:', e.message);
      }
    }
    return _autoUpdater;
  }

  // 配置自动更新（仅生产环境）
  if (!isDev) {
    const updater = getAutoUpdater();
    if (updater) {
      updater.setFeedURL({
        provider: 'github',
        owner: 'Devldq',
        repo: 'arm-claw',
      });
      updater.autoDownload = false;

      updater.on('checking-for-update', () => {
        console.log('🔍 Checking for updates...');
      });
      updater.on('update-available', (info) => {
        console.log('✅ Update available:', info.version);
        if (mainWindow) {
          mainWindow.webContents.send('update-available', {
            version: info.version,
            releaseNotes: info.releaseNotes,
          });
        }
      });
      updater.on('update-not-available', (info) => {
        console.log('✅ Already on latest version:', info.version);
      });
      updater.on('error', (err) => {
        console.error('❌ Update error:', err);
      });
      updater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        console.log(`📥 Downloading: ${percent}%`);
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            percent,
            transferred: progressObj.transferred,
            total: progressObj.total,
          });
        }
      });
      updater.on('update-downloaded', (info) => {
        console.log('✅ Update downloaded:', info.version);
        if (mainWindow) {
          mainWindow.webContents.send('update-downloaded', {
            version: info.version,
          });
        }
      });
    }
  }

  // IPC 处理：打开文件夹选择对话框
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
      const updater = getAutoUpdater();
      if (updater) {
        try {
          await updater.downloadUpdate();
          return { success: true };
        } catch (error) {
          console.error('Download failed:', error);
          return { success: false, error: error.message };
        }
      }
    }
    return { success: false, error: 'Dev mode' };
  });

  // IPC 处理：安装更新并重启
  ipcMain.handle('install-update', () => {
    if (!isDev) {
      const updater = getAutoUpdater();
      if (updater) updater.quitAndInstall(false, true);
    }
  });

  // IPC 处理：检查更新
  ipcMain.handle('check-for-updates', async () => {
    if (!isDev) {
      const updater = getAutoUpdater();
      if (updater) {
        try {
          const result = await updater.checkForUpdates();
          return { success: true, updateInfo: result?.updateInfo };
        } catch (error) {
          console.error('Check failed:', error);
          return { success: false, error: error.message };
        }
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
      mainWindow.loadURL('http://localhost:3000');
      mainWindow.webContents.openDevTools();
    } else {
      // 生产模式：使用动态端口
      if (nextServerPort) {
        mainWindow.loadURL(`http://localhost:${nextServerPort}`);
      } else {
        console.error('❌ Next.js server port not available');
        dialog.showErrorBox('启动失败', '无法启动 Next.js 服务器');
        app.quit();
      }
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  // 生产模式：在 Electron 进程中直接启动 Next.js（支持动态端口）
  if (!isDev) {
    app.whenReady().then(async () => {
      try {
        const next = require('next');
        const nextApp = next({
          dev: false,
          dir: app.getAppPath(),
          conf: { distDir: '.next' },
        });

        await nextApp.prepare();
        const handle = nextApp.getRequestHandler();

        const server = http.createServer((req, res) => {
          handle(req, res);
        });

        // 从环境变量读取端口，如果未设置则使用 0（随机端口）
        const configuredPort = process.env.ELECTRON_NEXT_PORT
          ? parseInt(process.env.ELECTRON_NEXT_PORT, 10)
          : 0;

        server.listen(configuredPort, 'localhost', () => {
          const address = server.address();
          nextServerPort = address.port;
          console.log(`✅ Next.js server ready on http://localhost:${nextServerPort}`);
          createWindow();

          setTimeout(() => {
            const updater = getAutoUpdater();
            if (updater) updater.checkForUpdates();
          }, 5000);
        });

        app.on('before-quit', () => {
          server.close();
        });
      } catch (error) {
        console.error('❌ Failed to start Next.js:', error);
        dialog.showErrorBox('Failed to start', `Error: ${error.message}`);
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

} catch (e) {
  // 非 Electron 环境（如 electron-builder 静态分析时）忽略所有错误
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[main.js] 非 Electron 环境，跳过初始化:', e.message);
  }
}
