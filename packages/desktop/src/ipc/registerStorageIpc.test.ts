import { describe, expect, it, vi } from 'vitest'
import { registerStorageIpc } from './registerStorageIpc'

describe('storage IPC', () => {
  it('rejects untrusted senders and malformed IDs/absolute internal paths', async () => {
    const handlers = new Map<string, Function>()
    const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services: {} as any })
    const event = { senderFrame: { url: 'https://evil.invalid/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:open-volume', volumeId: 'v1' })).resolves.toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    const trusted = { senderFrame: { url: 'http://127.0.0.1:4444/settings' } }
    await expect(handlers.get('storage:invoke')!(trusted, { channel: 'storage:open-volume', volumeId: 'C:\\secret' })).resolves.toMatchObject({ ok: false })
  })

  it('envelopes schema, service, and invalid-success failures', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { openVolume: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'VOLUME_OFFLINE' }) }) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    expect(await handlers.get('storage:invoke')!(event, { nope: true })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await handlers.get('storage:invoke')!(event, { channel: 'storage:open-volume', volumeId: 'v1' })).toEqual({ ok: false, error: { code: 'VOLUME_OFFLINE', message: 'offline' } })
    services.openVolume = vi.fn(async () => {}); services.syncVolume = vi.fn(async () => '')
    expect(await handlers.get('storage:invoke')!(event, { channel: 'storage:sync-volume', volumeId: 'v1' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('rejects a wrong webContents sender and a same-origin child frame', async () => {
    const handlers=new Map<string,Function>(); const ipc:any={handle:(name:string,fn:Function)=>handlers.set(name,fn),removeHandler:vi.fn()}; registerStorageIpc({ipcMain:ipc,trustedOrigin:'http://127.0.0.1:4444',trustedSenderId:9,services:{} as any})
    const frame:any={url:'http://127.0.0.1:4444/'}; frame.top=frame
    expect(await handlers.get('storage:invoke')!({sender:{id:8},senderFrame:frame},{channel:'storage:open-volume',volumeId:'v'})).toMatchObject({ok:false,error:{code:'UNTRUSTED_SENDER'}})
    const top:any={url:frame.url}; const child:any={url:frame.url,top}
    expect(await handlers.get('storage:invoke')!({sender:{id:9},senderFrame:child},{channel:'storage:open-volume',volumeId:'v'})).toMatchObject({ok:false,error:{code:'UNTRUSTED_FRAME'}})
  })

  it('returns an event disposer and removes its listener', () => {
    const listeners = new Map<string, Function>()
    const ipcRenderer: any = { on: (n: string, f: Function) => listeners.set(n, f), removeListener: vi.fn() }
    const { subscribeProgress } = registerStorageIpc.createRendererBridge(ipcRenderer)
    const dispose = subscribeProgress(vi.fn())
    dispose()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('storage:progress', listeners.get('storage:progress'))
  })

  it('returns a durable operation id before a deferred migration completes', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    let finish!: () => void
    const completion = new Promise<void>((resolve) => { finish = resolve })
    const services: any = { moveGroup: vi.fn(async () => ({ operationId: 'op-deferred', completion })) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:move-group', groupId: 'work', targetVolumeId: 'v2' })).resolves.toEqual({ ok: true, operationId: 'op-deferred' })
    expect(services.moveGroup).toHaveBeenCalledOnce()
    finish()
  })
})
