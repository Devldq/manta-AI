import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BootstrapStore } from '@manta/storage-hub'
import { SelectionStore } from './SelectionStore'
import { registerOnboardingIpc } from './registerOnboardingIpc'

function harness(bootstrapPath: string) {
  const handlers = new Map<string, (event: any, input?: unknown) => unknown>()
  const window = { webContents: { id: 41, mainFrame: { routingId: 9, url: 'file:///onboarding/index.html' } } }
  const ipcMain = { handle: vi.fn((name: string, handler: (event: any, input?: unknown) => unknown) => handlers.set(name, handler)), removeHandler: vi.fn() }
  const dispose = registerOnboardingIpc({
    ipcMain: ipcMain as any,
    getWindow: () => window as any,
    dialog: { showOpenDialog: vi.fn() } as any,
    app: { getPath: vi.fn((name: string) => name === 'home' ? 'C:/home' : ''), quit: vi.fn(), relaunch: vi.fn() } as any,
    selections: new SelectionStore(),
    bootstrapPath,
    initializeStorage: vi.fn(),
    onboardingUrl: 'file:///onboarding/index.html',
  })
  const trustedEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  return { handlers, window, dispose, trustedEvent }
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
})
