import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  openPath: vi.fn<(path: string) => Promise<string>>(),
}))
const sdk = vi.hoisted(() => ({
  createDesktopSessionURL: vi.fn<() => Promise<string>>(),
  stopLocalService: vi.fn<(home?: string) => Promise<boolean>>(),
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/tmp/manta-test'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    relaunch: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(async () => {}),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: electron.openPath },
}))
vi.mock('@manta/sdk/node', () => ({
  createDesktopSessionURL: sdk.createDesktopSessionURL,
  createLocalManta: vi.fn(),
  stopLocalService: sdk.stopLocalService,
}))

import { createDesktopServiceSessionURL, openPathOrThrow, restartDevelopmentLocalService, shouldRecoverStorageInDesktopProcess } from './desktop-runtime'

describe('desktop shell paths', () => {
  beforeEach(() => {
    electron.openPath.mockReset()
    sdk.createDesktopSessionURL.mockReset()
    sdk.stopLocalService.mockReset()
  })

  it('throws the error string returned by Electron shell.openPath', async () => {
    electron.openPath.mockResolvedValue('The folder could not be opened')

    await expect(openPathOrThrow('/missing/storage')).rejects.toThrow('The folder could not be opened')
  })

  it('resolves after Electron opens the folder successfully', async () => {
    electron.openPath.mockResolvedValue('')

    await expect(openPathOrThrow('/managed/storage')).resolves.toBeUndefined()
    expect(electron.openPath).toHaveBeenCalledWith('/managed/storage')
  })

  it('stops a stale local service before a development desktop starts', async () => {
    sdk.stopLocalService.mockResolvedValue(true)

    await expect(restartDevelopmentLocalService()).resolves.toBe(true)
    expect(sdk.stopLocalService).toHaveBeenCalledWith('/tmp/manta-test')
  })

  it('allows a cold local Service to finish recovery before timing out', async () => {
    sdk.createDesktopSessionURL.mockResolvedValue('http://127.0.0.1:1234/session')

    await expect(createDesktopServiceSessionURL()).resolves.toBe('http://127.0.0.1:1234/session')
    expect(sdk.createDesktopSessionURL).toHaveBeenCalledWith(expect.objectContaining({
      home: '/tmp/manta-test',
      startupTimeoutMs: 5 * 60_000,
    }))
  })

  it('leaves storage recovery and Agent activation to the standalone Service', () => {
    expect(shouldRecoverStorageInDesktopProcess(true)).toBe(false)
    expect(shouldRecoverStorageInDesktopProcess(false)).toBe(true)
  })
})
