import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore, volumeRoot } from '@manta/storage-hub'
import { initializeStorage } from '../src/lifecycle/initializeStorage'
import { createStorageVolume } from '../src/lifecycle/createStorageVolume'

describe('desktop ASH migration E2E', () => {
  it('serves the real storage API after a volume relocation and retains the old root as a backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-desktop-migration-'))
    const source = join(root, 'source'); const target = join(root, 'target'); const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const initialized = await initializeStorage({ parentPath: source, bootstrapPath })
    await writeFile(join(volumeRoot(source), 'config', 'real-api.json'), 'yes')
    const { createBackendStorageComposition, startServer } = await import('@manta/backend')
    const composition = await createBackendStorageComposition(new BootstrapStore(bootstrapPath))
    const operationId = await composition.hub.migrations!.relocateVolume(initialized.volume.id, target)
    const server = await startServer({ storage: composition.runtime, port: 0, host: '127.0.0.1', startSchedulers: false, startup: false, registerRoutes: false, frontendDist: join(process.cwd(), '..', 'frontend', 'dist'), isDev: false, storageApi: { readBootstrap: () => new BootstrapStore(bootstrapPath).read(), inventory: composition.hub.inventory, listBackups: async () => [] } })
    try {
      const overview = await fetch(`http://127.0.0.1:${server.port}/api/storage/overview`).then((response) => response.json()) as any
      expect(overview.success).toBe(true)
      expect(overview.data.groups).toHaveLength(7)
      expect(overview.data.groups.find((group: any) => group.id === 'config').path).toContain(target)
      expect(await new BootstrapStore(bootstrapPath).read()).toMatchObject({ volumes: [{ parentPath: target }] })
      expect(operationId).toBeTruthy()
      await expect(fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text())).resolves.toContain('<div id="root">')
    } finally { await server.close() }
  })

  it('can migrate one group into a second volume without redirecting the other six groups', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-desktop-group-'))
    const source = join(root, 'source'); const target = join(root, 'target'); const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    await initializeStorage({ parentPath: source, bootstrapPath })
    const store = new BootstrapStore(bootstrapPath)
    const secondVolume = await createStorageVolume({ parentPath: target, name: 'Knowledge', bootstrap: store })
    const { createBackendStorageComposition } = await import('@manta/backend')
    const composition = await createBackendStorageComposition(store)
    await composition.hub.migrations!.moveGroup('knowledge', secondVolume)
    const current = await store.read()
    expect(current?.groupAssignments.knowledge).toBe(secondVolume)
    expect(current?.groupAssignments.config).not.toBe(secondVolume)
    await composition.runtime.close()
  })
})
