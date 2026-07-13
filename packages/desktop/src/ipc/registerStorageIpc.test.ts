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
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:move-group', groupId: 'work', targetVolumeId: 'v2' })).resolves.toEqual({ ok: true, kind: 'operation-started', operationId: 'op-deferred' })
    expect(services.moveGroup).toHaveBeenCalledOnce()
    finish()
  })

  it('returns an immediate volume-created result without starting an operation', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { createVolume: vi.fn(async () => 'volume-new') }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:create-volume', selectionId: 'selection-1', name: 'New volume' })).resolves.toEqual({ ok: true, kind: 'volume-created', volumeId: 'volume-new' })
  })

  it('waits for Git binding initialization and returns the persisted binding, not a synthetic operation id', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { configureGit: vi.fn(async () => ({ volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' })) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:configure-git', volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', authRef: 'keychain:work' })).resolves.toEqual({ ok: true, kind: 'git-configured', binding: { volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' } })
    expect(services.configureGit).toHaveBeenCalledWith('v1', expect.objectContaining({ mode: 'remote', remoteUrl: 'https://example.test/ash.git', authRef: 'keychain:work' }))
  })

  it('returns the Git initialization failure to the renderer instead of acknowledging a detached operation', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { configureGit: vi.fn(async () => { throw Object.assign(new Error('Git executable was not found'), { code: 'GIT_UNAVAILABLE' }) }) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:configure-git', volumeId: 'v1', mode: 'local' })).resolves.toEqual({ ok: false, error: { code: 'GIT_UNAVAILABLE', message: 'Git executable was not found' } })
  })

  it('envelopes an incompatible Git binding as a typed conflict for the renderer', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { configureGit: vi.fn(async () => { throw Object.assign(new Error('Volume v1 already has a local Git binding'), { code: 'GIT_BINDING_CONFLICT' }) }) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:configure-git', volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git' })).resolves.toEqual({ ok: false, error: { code: 'GIT_BINDING_CONFLICT', message: 'Volume v1 already has a local Git binding' } })
  })

  it('rejects a credential value or arbitrary path in Git configuration', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { configureGit: vi.fn(async () => ({ volumeId: 'v1', mode: 'local', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' })) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:configure-git', volumeId: 'v1', mode: 'remote', remoteUrl: 'https://token@evil.test/repo.git', authRef: 'C:\\secret' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })
})
