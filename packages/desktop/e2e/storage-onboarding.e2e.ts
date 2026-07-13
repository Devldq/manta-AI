import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore } from '@manta/storage-hub'
import { DesktopLifecycleController } from '../src/lifecycle/DesktopLifecycleController'
import { initializeStorage } from '../src/lifecycle/initializeStorage'

describe('desktop ASH onboarding E2E', () => {
  it('keeps the backend closed until first-run storage initialization and then opens the actual backend URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ash-desktop-onboarding-'))
    const bootstrapPath = join(directory, 'user-data', 'ash-bootstrap.json')
    const opened: string[] = []; let onboarding = 0; let serverStarts = 0
    const controller = new DesktopLifecycleController({
      readBootstrap: () => new BootstrapStore(bootstrapPath).read(), recover: async () => {},
      composeStorage: async () => ({ runtime: { resolve: () => directory }, hub: {} }),
      startServer: async () => { serverStarts += 1; return { port: 38123, async quiesce() {}, async close() {}, async healthCheck() { return { ok: true } } } },
      openOnboarding: async () => { onboarding += 1 }, openMain: async (url) => { opened.push(url) },
      readRelaunchIntent: async () => undefined, prepareRelaunch: async () => {}, rollbackRelaunchIntent: async () => {}, completeRelaunchOperation: async () => {}, clearRelaunchIntent: async () => {}, resetComposition: async () => {}, quit() {}, relaunch() {}, seedRoot: directory,
    })
    await expect(controller.start()).resolves.toEqual({ ok: true })
    expect(onboarding).toBe(1); expect(serverStarts).toBe(0); expect(opened).toEqual([])
    await initializeStorage({ parentPath: join(directory, 'cloud-parent'), bootstrapPath })
    await expect(controller.start()).resolves.toEqual({ ok: true })
    expect(serverStarts).toBe(1); expect(opened).toEqual(['http://127.0.0.1:38123'])
  })
})
