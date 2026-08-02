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
    expect(await handlers.get('storage:invoke')!(event, { channel: 'storage:sync-volume', volumeId: 'v1' })).toEqual({ ok: true, kind: 'completed' })
    expect(services.syncVolume).toHaveBeenCalledWith('v1')
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

  it('returns a typed remote conflict plan and requires its opaque session when applying it', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const plan = { volumeId: 'v1', sessionId: 'import-session-1', requiresConfirmation: true, groups: [{ group: 'knowledge', state: 'database-conflict', choices: ['keep-local', 'keep-remote'], defaultChoice: 'keep-local' }] }
    const services: any = { planGitImport: vi.fn(async () => plan), applyGitImport: vi.fn(async () => {}) }
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services })
    const event = { senderFrame: { url: 'http://127.0.0.1:4444/' } }
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:plan-git-import', volumeId: 'v1' })).resolves.toEqual({ ok: true, kind: 'git-import-plan', plan })
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:apply-git-import', volumeId: 'v1', sessionId: 'import-session-1', decisions: { knowledge: 'keep-remote' } })).resolves.toEqual({ ok: true, kind: 'completed' })
    expect(services.applyGitImport).toHaveBeenCalledWith('v1', { sessionId: 'import-session-1', decisions: { knowledge: 'keep-remote' } })
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

  it('requires a native high-risk confirmation and a one-use sender/frame/origin/volume-bound grant to enable secrets', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { confirmGitSecrets: vi.fn(async () => true), setGitSecretsPolicy: vi.fn(async (_volumeId: string, includeSecrets: boolean) => ({ volumeId: 'v1', mode: 'local', includeSecrets, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' })) }
    let now = 1_000
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', trustedSenderId: 9, services, now: () => now, randomId: () => 'opaque-grant-1', secretsGrantTtlMs: 100 })
    const frame: any = { url: 'http://127.0.0.1:4444/settings', routingId: 41 }; frame.top = frame
    const event = { sender: { id: 9 }, senderFrame: frame }
    const granted = await handlers.get('storage:invoke')!(event, { channel: 'storage:request-git-secrets-grant', volumeId: 'v1' })
    expect(services.confirmGitSecrets).toHaveBeenCalledWith('v1', event)
    expect(granted).toEqual({ ok: true, kind: 'git-secrets-grant', grant: 'opaque-grant-1', expiresAt: 1100 })

    const otherFrame: any = { ...frame, routingId: 42 }; otherFrame.top = otherFrame
    await expect(handlers.get('storage:invoke')!({ ...event, senderFrame: otherFrame }, { channel: 'storage:set-git-secrets-policy', volumeId: 'v1', includeSecrets: true, grant: 'opaque-grant-1' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GIT_SECRETS_GRANT' } })
    await expect(handlers.get('storage:invoke')!({ ...event, sender: { id: 10 } }, { channel: 'storage:set-git-secrets-policy', volumeId: 'v1', includeSecrets: true, grant: 'opaque-grant-1' })).resolves.toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:set-git-secrets-policy', volumeId: 'v2', includeSecrets: true, grant: 'opaque-grant-1' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GIT_SECRETS_GRANT' } })
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:set-git-secrets-policy', volumeId: 'v1', includeSecrets: true, grant: 'opaque-grant-1' })).resolves.toMatchObject({ ok: true, kind: 'git-secrets-policy', binding: { includeSecrets: true } })
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:set-git-secrets-policy', volumeId: 'v1', includeSecrets: true, grant: 'opaque-grant-1' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GIT_SECRETS_GRANT' } })
  })

  it('rejects expired grants and cannot enable secrets through ordinary Git configuration', async () => {
    const handlers = new Map<string, Function>(); const ipc: any = { handle: (name: string, fn: Function) => handlers.set(name, fn), removeHandler: vi.fn() }
    const services: any = { confirmGitSecrets: vi.fn(async () => true), configureGit: vi.fn(), setGitSecretsPolicy: vi.fn() }; let now = 1_000
    registerStorageIpc({ ipcMain: ipc, trustedOrigin: 'http://127.0.0.1:4444', services, now: () => now, randomId: () => 'opaque-grant-2', secretsGrantTtlMs: 10 })
    const frame: any = { url: 'http://127.0.0.1:4444/', routingId: 7 }; frame.top = frame; const event = { sender: { id: 3 }, senderFrame: frame }
    await handlers.get('storage:invoke')!(event, { channel: 'storage:request-git-secrets-grant', volumeId: 'v1' }); now = 1_011
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:set-git-secrets-policy', volumeId: 'v1', includeSecrets: true, grant: 'opaque-grant-2' })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GIT_SECRETS_GRANT' } })
    await expect(handlers.get('storage:invoke')!(event, { channel: 'storage:configure-git', volumeId: 'v1', mode: 'local', includeSecrets: true })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(services.configureGit).not.toHaveBeenCalled()
  })
})
