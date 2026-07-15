import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function onboardingPageUrl(): string {
  return pathToFileURL(join(__dirname, '..', 'onboarding', 'index.html')).href
}

export function createOnboardingWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 720,
    height: 620,
    resizable: false,
    closable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'onboarding-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  const onboardingUrl = onboardingPageUrl()
  const preventUnexpectedNavigation = (event: Electron.Event, url: string) => {
    if (url !== onboardingUrl) event.preventDefault()
  }
  window.webContents.on('will-navigate', preventUnexpectedNavigation)
  window.webContents.on('will-frame-navigate' as any, preventUnexpectedNavigation)
  window.webContents.on('will-redirect', preventUnexpectedNavigation)
  window.once('ready-to-show', () => window.show())
  void window.loadURL(onboardingUrl)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}
