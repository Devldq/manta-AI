import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  openPath: vi.fn<(path: string) => Promise<string>>(),
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

import { openPathOrThrow } from './desktop-runtime'

describe('desktop shell paths', () => {
  beforeEach(() => {
    electron.openPath.mockReset()
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
})
