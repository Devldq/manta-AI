const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow = null;
let serverProcess = null;
let _autoUpdater = null;

// 懒加载 electron-updater
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
      repo: 'manta-ai',
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
    title: '选择目录',
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

// IPC 处理：打开数据目录
ipcMain.handle('app:openDataDir', async () => {
  const { shell } = require('electron');
  const os = require('os');
  const dataDir = path.join(os.homedir(), '.manta-data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  await shell.openPath(dataDir);
  return { success: true };
});

// IPC 处理：重置系统
ipcMain.handle('app:resetSystem', async () => {
  const os = require('os');
  const dataDir = path.join(os.homedir(), '.manta-data');

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['取消', '确认重置'],
    defaultId: 0,
    cancelId: 0,
    title: '重置系统',
    message: '确定要重置系统吗？',
    detail: '这将删除所有本地数据（~/.manta-data），包括会话记录、LLM 配置、插件设置、记忆等。此操作不可撤销。',
  });

  if (result.response !== 1) return { success: false, canceled: true };

  try {
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 等待服务器启动
async function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        http.get(url, (res) => {
          if (res.statusCode === 200) resolve();
          else reject();
        }).on('error', reject);
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('Server startup timeout');
}

// 启动后端服务器
async function startServer() {
  const serverPath = path.join(__dirname, '..', '..', 'server', 'dist', 'index.js');
  
  if (!fs.existsSync(serverPath)) {
    console.error('❌ Server build not found:', serverPath);
    return null;
  }

  const port = 3001;
  serverProcess = spawn('node', [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`[Server] Process exited with code ${code}`);
    serverProcess = null;
  });

  try {
    await waitForServer(`http://localhost:${port}/api/health`);
    console.log('✅ Server started successfully');
    return port;
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    return null;
  }
}

// 创建窗口
async function createWindow() {
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
    // 开发模式：加载 Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式：启动后端服务器并加载前端
    const port = await startServer();
    if (port) {
      // 加载打包后的前端文件
      const webPath = path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
      if (fs.existsSync(webPath)) {
        mainWindow.loadFile(webPath);
      } else {
        console.error('❌ Web build not found:', webPath);
        dialog.showErrorBox('启动失败', '无法找到前端文件');
        app.quit();
        return;
      }
    } else {
      dialog.showErrorBox('启动失败', '无法启动后端服务器');
      app.quit();
      return;
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 生产环境下检查更新
  if (!isDev) {
    setTimeout(() => {
      const updater = getAutoUpdater();
      if (updater) updater.checkForUpdates();
    }, 5000);
  }
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

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// 启动应用
app.whenReady().then(createWindow);
