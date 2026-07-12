import { describe, expect, it, vi } from 'vitest'
import { registerStorageIpc } from './registerStorageIpc'

describe('storage IPC', () => {
  it('rejects untrusted senders and malformed IDs/absolute internal paths', async () => {
    const handlers = new Map<string, Function>()
    const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services: {} as any })
    const event = { senderFrame: { url: 'https://evil.invalid/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:open-volume', volumeId: 'v1' })).rejects.toThrow('Untrusted')
    const trusted = { senderFrame: { url: 'http://127.0.0.1:4444/settings' } }
    await expect(handlers.get('storage:invoke')!(trusted, { channel: 'storage:open-volume', volumeId: 'C:\\secret' })).rejects.toThrow()
  })

  it('returns an event disposer and removes its listener', () => {
    const listeners = new Map<string, Function>()
    const ipcRenderer: any = { on: (n: string, f: Function) => listeners.set(n, f), removeListener: vi.fn() }
    const { subscribeProgress } = registerStorageIpc.createRendererBridge(ipcRenderer)
    const dispose = subscribeProgress(vi.fn())
    dispose()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('storage:progress', listeners.get('storage:progress'))
  })
})
