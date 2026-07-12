import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createOnboardingWindow(): BrowserWindow {
  const window = new BrowserWindow({ width: 720, height: 620, resizable: false, closable: true, show: false, webPreferences: { preload: join(__dirname, '..', 'preload', 'onboarding-preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.once('ready-to-show', () => window.show()); void window.loadFile(join(__dirname, '..', 'onboarding', 'index.html'))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
