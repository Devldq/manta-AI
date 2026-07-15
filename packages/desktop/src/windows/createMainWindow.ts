import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { preload: join(__dirname, '..', 'preload', 'main-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.once('ready-to-show', () => window.show()); void window.loadURL(url)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
