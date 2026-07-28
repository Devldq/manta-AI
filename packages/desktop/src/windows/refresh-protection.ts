import type { MenuItemConstructorOptions } from 'electron'

export interface RendererKeyboardInput {
  type: string
  key: string
  control: boolean
  meta: boolean
}

export function isRendererRefreshShortcut(input: RendererKeyboardInput): boolean {
  if (input.type !== 'keyDown') return false
  const key = input.key.toLowerCase()
  return key === 'f5' || (key === 'r' && (input.control || input.meta))
}

/**
 * Keep the standard desktop editing/window controls while deliberately
 * excluding Electron's reload and force-reload roles.
 */
export function createRefreshSafeMenuTemplate(
  platform: NodeJS.Platform,
  packaged: boolean,
): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        ...(!packaged ? [{ role: 'toggleDevTools' as const }] : []),
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
}
