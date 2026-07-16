import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore, STORAGE_GROUP_IDS, volumeRoot } from '@manta/storage-hub'
import { createBackendStorageComposition, startServer } from '@manta/backend'
import { DesktopLifecycleController } from '../src/lifecycle/DesktopLifecycleController'
import { initializeStorage } from '../src/lifecycle/initializeStorage'
import type { OnboardingProgressEvent } from '../src/onboarding/progress-contract'
import { upgradeBootstrapVolumeDirectories } from '../src/lifecycle/LegacyVolumeUpgrade'

describe('desktop ASH onboarding E2E', () => {
  it('does not create a backend listener until initialization, then serves health and the packaged frontend from the selected root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-desktop-onboarding-'))
    const bootstrapPath = join(directory, 'user-data', 'ash-bootstrap.json')
    const frontendDist = join(directory, 'frontend-dist')
    await mkdir(frontendDist, { recursive: true })
    await writeFile(join(frontendDist, 'index.html'), '<!doctype html><div id="root">ASH desktop fixture</div>')
    const windows: Array<{ kind: 'onboarding' | 'main'; url?: string }> = []
    let composition: Awaited<ReturnType<typeof createBackendStorageComposition>> | undefined
    let listenerStarted = false
    const progress: OnboardingProgressEvent[] = []
    const controller = new DesktopLifecycleController({
      readBootstrap: () => new BootstrapStore(bootstrapPath).read(),
      preflightStorage: (...bootstraps) => upgradeBootstrapVolumeDirectories(...bootstraps),
      recover: async () => {},
      composeStorage: async () => composition ??= await createBackendStorageComposition(new BootstrapStore(bootstrapPath)),
      startServer: async ({ storage }) => {
        listenerStarted = true
        return startServer({ storage: storage as any, port: 0, host: '127.0.0.1', startSchedulers: false, startup: false, registerRoutes: false, frontendDist, isDev: false })
      },
      // Electron is deliberately isolated to this BrowserWindow boundary.
      openOnboarding: async () => { windows.push({ kind: 'onboarding' }) },
      openMain: async (url) => { windows.push({ kind: 'main', url }) },
      readRelaunchIntent: async () => undefined,
      prepareRelaunch: async () => {}, rollbackRelaunchIntent: async () => {}, completeRelaunchOperation: async () => {}, clearRelaunchIntent: async () => {},
      resetComposition: async () => { await composition?.runtime.close(); composition = undefined }, quit() {}, relaunch() {}, seedRoot: directory,
    })

    await expect(controller.start()).resolves.toEqual({ ok: true })
    expect(listenerStarted).toBe(false)
    expect(composition).toBeUndefined()
    expect(windows).toEqual([{ kind: 'onboarding' }])

    const initialized = await initializeStorage({ parentPath: join(directory, 'cloud-parent'), bootstrapPath, onProgress: (event) => progress.push(event) })
    expect(initialized.volume.parentPath).toBe(join(directory, 'cloud-parent'))
    for (const group of STORAGE_GROUP_IDS) await expect(access(join(volumeRoot(initialized.volume.parentPath), group))).resolves.toBeUndefined()
    await expect(new BootstrapStore(bootstrapPath).read()).resolves.toMatchObject({ volumes: [{ id: initialized.volume.id, parentPath: initialized.volume.parentPath }] })

    await expect(controller.continueAfterOnboarding((event) => progress.push(event))).resolves.toEqual({ ok: true })
    expect(listenerStarted).toBe(true)
    const main = windows.find((entry) => entry.kind === 'main')
    expect(main?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await expect(fetch(`${main!.url}/api/health`).then((response) => response.json())).resolves.toMatchObject({ success: true, data: { status: 'ok', dataDir: join(volumeRoot(initialized.volume.parentPath), 'config') } })
    await expect(fetch(`${main!.url}/`).then((response) => response.text())).resolves.toContain('ASH desktop fixture')

    expect(progress).toEqual([
      { step: 'validate-parent', state: 'active' }, { step: 'validate-parent', state: 'complete' },
      { step: 'create-volume', state: 'active' }, { step: 'create-volume', state: 'complete' },
      { step: 'create-groups', state: 'active' }, { step: 'create-groups', state: 'complete' },
      { step: 'write-manifest', state: 'active' }, { step: 'write-manifest', state: 'complete' },
      { step: 'commit-bootstrap', state: 'active' }, { step: 'commit-bootstrap', state: 'complete' },
      { step: 'verify-storage', state: 'active' }, { step: 'verify-storage', state: 'complete' },
      { step: 'initialize-services', state: 'active' }, { step: 'initialize-services', state: 'complete' },
      { step: 'start-backend', state: 'active' }, { step: 'start-backend', state: 'complete' },
      { step: 'open-main', state: 'active' }, { step: 'open-main', state: 'complete' },
    ])

    await controller.shutdown()
  })
})
