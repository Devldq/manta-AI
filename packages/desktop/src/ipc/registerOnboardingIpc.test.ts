import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BootstrapStore } from '@manta/storage-hub'
import { SelectionStore } from './SelectionStore'
import { registerOnboardingIpc } from './registerOnboardingIpc'
import type { OnboardingProgressReporter } from '../onboarding/progress-contract'

function harness(bootstrapPath: string) {
  const handlers = new Map<string, (event: any, input?: unknown) => unknown>()
  const window = { webContents: { id: 41, mainFrame: { routingId: 9, url: 'file:///onboarding/index.html' }, send: vi.fn(), isDestroyed: vi.fn(() => false) } }
  const ipcMain = { handle: vi.fn((name: string, handler: (event: any, input?: unknown) => unknown) => handlers.set(name, handler)), removeHandler: vi.fn() }
  const app = { quit: vi.fn(), relaunch: vi.fn() }
  const dialog = { showOpenDialog: vi.fn() }
  const initializeStorage = vi.fn()
  const completeInitialization = vi.fn<(onProgress: OnboardingProgressReporter) => Promise<{ ok: true }>>(async () => ({ ok: true }))
  const onInitialized = vi.fn()
  const dispose = registerOnboardingIpc({
    ipcMain: ipcMain as any,
    getWindow: () => window as any,
    dialog: dialog as any,
    app: app as any,
    selections: new SelectionStore(),
    bootstrapPath,
    initializeStorage,
    completeInitialization,
    onInitialized,
    onboardingUrl: 'file:///onboarding/index.html',
  })
  const trustedEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  return { handlers, window, dispose, trustedEvent, app, dialog, initializeStorage, completeInitialization, onInitialized }
}

describe('registerOnboardingIpc', () => {
  it('reports durable needs-selection before Bootstrap exists and initialized after it is written', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-state-'))
    const bootstrapPath = join(directory, 'ash-bootstrap.json')
    const { handlers, trustedEvent } = harness(bootstrapPath)

    await expect(handlers.get('onboarding:state')!(trustedEvent)).resolves.toEqual({ ok: true, initialized: false, needsSelection: true })
    await writeFile(bootstrapPath, JSON.stringify({ schemaVersion: 1, generation: 1, volumes: [{ id: 'default', name: 'Default', parentPath: directory, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' }], groupAssignments: { extensions: 'default', knowledge: 'default', work: 'default', config: 'default', secrets: 'default', diagnostics: 'default', cache: 'default' } }), 'utf8')
    await expect(handlers.get('onboarding:state')!(trustedEvent)).resolves.toEqual({ ok: true, initialized: true, needsSelection: false })
  })

  it('rejects state requests from a different sender or frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-state-'))
    const { handlers, trustedEvent } = harness(join(directory, 'ash-bootstrap.json'))

    await expect(handlers.get('onboarding:state')!({ ...trustedEvent, sender: { id: 42 } })).rejects.toThrow('Untrusted IPC sender')
    await expect(handlers.get('onboarding:state')!({ ...trustedEvent, senderFrame: { routingId: 10, url: 'file:///onboarding/index.html' } })).rejects.toThrow('Untrusted IPC sender')
  })

  it.each(['file:///attacker/index.html', 'https://attacker.example/onboarding/index.html'])('rejects privileged calls after the original main frame navigates to %s', async (attackerUrl) => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-origin-'))
    const { handlers, window, trustedEvent } = harness(join(directory, 'ash-bootstrap.json'))
    window.webContents.mainFrame.url = attackerUrl

    await expect(handlers.get('onboarding:select-parent')!(trustedEvent)).rejects.toThrow('Untrusted IPC sender')
    await expect(handlers.get('onboarding:initialize')!(trustedEvent, { selectionId: 'forged' })).rejects.toThrow('Untrusted IPC sender')
  })

  it('registers exactly the four onboarding IPC methods', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-surface-'))
    const { handlers } = harness(join(directory, 'ash-bootstrap.json'))

    expect([...handlers.keys()].sort()).toEqual([
      'onboarding:initialize',
      'onboarding:quit',
      'onboarding:select-parent',
      'onboarding:state',
    ])
  })

  it('streams real progress and hands off without relaunching or quitting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-progress-'))
    const h = harness(join(directory, 'ash-bootstrap.json'))
    h.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [directory] })
    h.initializeStorage.mockImplementation(async ({ onProgress }) => {
      onProgress({ step: 'validate-parent', state: 'active' })
      onProgress({ step: 'validate-parent', state: 'complete' })
    })
    h.completeInitialization.mockImplementation(async (onProgress) => {
      onProgress({ step: 'initialize-services', state: 'active' })
      onProgress({ step: 'initialize-services', state: 'complete' })
      return { ok: true }
    })

    const selection = await h.handlers.get('onboarding:select-parent')!(h.trustedEvent) as { selectionId: string }
    await expect(h.handlers.get('onboarding:initialize')!(h.trustedEvent, selection)).resolves.toEqual({ ok: true })

    expect(h.window.webContents.send.mock.calls).toEqual([
      ['onboarding:progress', { step: 'validate-parent', state: 'active' }],
      ['onboarding:progress', { step: 'validate-parent', state: 'complete' }],
      ['onboarding:progress', { step: 'initialize-services', state: 'active' }],
      ['onboarding:progress', { step: 'initialize-services', state: 'complete' }],
    ])
    expect(h.onInitialized).toHaveBeenCalledOnce()
    expect(h.app.relaunch).not.toHaveBeenCalled()
    expect(h.app.quit).not.toHaveBeenCalled()
  })

  it('reuses the canonical consumed parent only for retries in the same trusted window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-onboarding-retry-'))
    const h = harness(join(directory, 'ash-bootstrap.json'))
    h.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [directory] })
    h.initializeStorage.mockRejectedValueOnce(Object.assign(new Error('temporary disk error'), { code: 'EIO' })).mockResolvedValueOnce(undefined)

    const selection = await h.handlers.get('onboarding:select-parent')!(h.trustedEvent) as { selectionId: string }
    await expect(h.handlers.get('onboarding:initialize')!(h.trustedEvent, selection)).resolves.toMatchObject({ ok: false, error: { code: 'EIO' } })
    await expect(h.handlers.get('onboarding:initialize')!(h.trustedEvent, selection)).resolves.toEqual({ ok: true })

    expect(h.initializeStorage).toHaveBeenCalledTimes(2)
    expect(h.initializeStorage.mock.calls[0][0].parentPath).toBe(directory)
    expect(h.initializeStorage.mock.calls[1][0].parentPath).toBe(directory)
  })
})
