import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export interface MainWindowOptions { forwardConsole?: boolean }

export function createMainWindow(url: string, options: MainWindowOptions = {}): BrowserWindow {
  const window = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { preload: join(__dirname, '..', 'preload', 'main-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  if (options.forwardConsole) {
    window.webContents.on('console-message', (details) => {
      const source = details.sourceId ? ` ${details.sourceId}:${details.lineNumber}` : ''
      const line = `[renderer:${details.level}] ${details.message}${source}\n`
      ;(details.level === 'error' || details.level === 'warning' ? process.stderr : process.stdout).write(line)
    })
  }
  window.once('ready-to-show', () => window.show()); void window.loadURL(url)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
