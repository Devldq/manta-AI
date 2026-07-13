import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { BootstrapStore, volumeRoot } from '@manta/storage-hub'
import { createBackendStorageComposition, startServer } from '@manta/backend'
import { initializeStorage } from '../src/lifecycle/initializeStorage'
import { createBrowserStorageImporter, openBrowserStorageImportDatabase } from '../../frontend/src/migrations/browser-storage-importer'
import { createClientStateApi } from '../../frontend/src/lib/client-state'
import { loadStagedFiles, saveStagedFiles } from '../../frontend/src/stores/lib/staged-files-db'

describe('browser-to-ASH E2E', () => {
  it('keeps browser sources while offline and removes them only after real HTTP writes create canonical config and cache files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-browser-rag-'))
    const bootstrapPath = join(root, 'user-data', 'ash-bootstrap.json')
    const initialized = await initializeStorage({ parentPath: join(root, 'icloud-parent'), bootstrapPath })
    const composition = await createBackendStorageComposition(new BootstrapStore(bootstrapPath))
    const server = await startServer({ storage: composition.runtime, port: 0, host: '127.0.0.1', startSchedulers: false, startup: false, registerRoutes: false })
    const base = `http://127.0.0.1:${server.port}`
    const nativeFetch = globalThis.fetch
    const remoteFetch: typeof fetch = (input, init) => nativeFetch(new URL(String(input), base), init)
    try {
      const databaseName = `ash-browser-${crypto.randomUUID()}`
      // The browser substrate is a real IndexedDB implementation; only the
      // browser itself is substituted, never the canonical HTTP persistence.
      const rawDb = indexedDB.open(databaseName, 4)
      await new Promise<void>((resolve, reject) => { rawDb.onupgradeneeded = () => rawDb.result.createObjectStore('records'); rawDb.onsuccess = () => { const tx = rawDb.result.transaction('records', 'readwrite'); tx.objectStore('records').put({ themeId: 'offline' }, 'theme'); tx.oncomplete = () => { rawDb.result.close(); resolve() }; tx.onerror = () => reject(tx.error) }; rawDb.onerror = () => reject(rawDb.error) })
      const database = await openBrowserStorageImportDatabase(databaseName, indexedDB)
      const client = createClientStateApi(remoteFetch)
      const offlineImporter = createBrowserStorageImporter({ database, persist: async () => { throw new Error('offline') } })
      await expect(offlineImporter.importOnce()).rejects.toThrow('offline')
      await expect(database.list()).resolves.toEqual([{ key: 'theme', value: { themeId: 'offline' } }])
      const importer = createBrowserStorageImporter({ database, persist: async (records) => { if (!(await client.set('theme', records.theme as object))) throw new Error('offline') } })
      await expect(importer.importOnce()).resolves.toBeUndefined()
      await expect(database.list()).resolves.toEqual([])
      await expect(readFile(join(volumeRoot(initialized.volume.parentPath), 'config', 'client-state', 'theme.json'), 'utf8')).resolves.toContain('offline')

      const originalFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => remoteFetch(input, init)
      const retry = { id: 'legacy', file: new File(['retry payload'], 'retry.txt', { type: 'text/plain' }), name: 'retry.txt', size: 13, type: 'text/plain' }
      try {
        globalThis.fetch = async () => { throw new Error('offline') }
        await expect(saveStagedFiles('knowledge', [retry])).rejects.toThrow('offline')
        globalThis.fetch = async (input, init) => remoteFetch(input, init)
        const recovered = await loadStagedFiles('knowledge')
        expect(recovered).toHaveLength(1)
      } finally { globalThis.fetch = originalFetch }
      const entries = await fetch(`${base}/api/storage/rag-staging/knowledge`).then((response) => response.json()) as any
      const id = entries.data.entries[0].id
      await expect(readFile(join(volumeRoot(initialized.volume.parentPath), 'cache', 'rag-staging', 'knowledge', `${id}.bin`), 'utf8')).resolves.toBe('retry payload')
      await expect(access(join(volumeRoot(initialized.volume.parentPath), 'cache', 'rag-staging', 'knowledge', `${id}.json`))).resolves.toBeUndefined()
    } finally { await server.close() }
  })
})
