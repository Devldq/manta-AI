import { describe, expect, it } from 'vitest'
import {
  createBrowserStorageImporter,
  openLegacyLocalStorageImportDatabase,
  type BrowserStorageDatabase,
} from './browser-storage-importer'

function database(records: Record<string, unknown>): BrowserStorageDatabase & { snapshot(): Record<string, unknown> } {
  let values = new Map(Object.entries(records))
  return {
    list: async () => [...values.entries()].map(([key, value]) => ({ key, value })),
    remove: async (keys) => { for (const key of keys) values.delete(key) },
    snapshot: () => Object.fromEntries(values),
  }
}

describe('browser storage importer', () => {
  it('keeps records when the canonical ASH write fails so a later retry can import them', async () => {
    const db = database({ 'manta:webhook': { url: 'https://example.test/hook' } })
    const importer = createBrowserStorageImporter({ database: db, persist: async () => { throw new Error('offline') } })

    await expect(importer.importOnce()).rejects.toThrow('offline')
    expect(db.snapshot()).toEqual({ 'manta:webhook': { url: 'https://example.test/hook' } })
  })

  it('deletes only successfully persisted keys and is idempotent on retry', async () => {
    const db = database({ 'manta:webhook': { enabled: true }, 'manta:theme': { themeId: 'cli-pixel' } })
    const writes: Array<Record<string, unknown>> = []
    const importer = createBrowserStorageImporter({ database: db, persist: async (records) => { writes.push(records) } })

    await importer.importOnce()
    await importer.importOnce()

    expect(writes).toEqual([{ 'manta:webhook': { enabled: true }, 'manta:theme': { themeId: 'cli-pixel' } }])
    expect(db.snapshot()).toEqual({})
  })

  it('recovers a valid previous manifest when current is corrupt and serializes concurrent imports', async () => {
    const db = database({
      '__ash_manifest_current__': '{bad json',
      '__ash_manifest_previous__': JSON.stringify({ version: 4, records: { 'manta:webhook': { enabled: true } } }),
    })
    let writes = 0
    const importer = createBrowserStorageImporter({
      database: db,
      persist: async () => { writes += 1 },
      manifestKeys: { current: '__ash_manifest_current__', previous: '__ash_manifest_previous__' },
    })

    await Promise.all([importer.importOnce(), importer.importOnce()])

    expect(writes).toBe(1)
    expect(db.snapshot()).toEqual({})
  })

  it('limits the legacy local-storage adapter to known keys and removes only requested keys', async () => {
    const values = new Map<string, string>([['manta:theme', '{"themeId":"x"}'], ['unrelated', 'keep']])
    const storage = { get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key), clear: () => values.clear(), setItem: (key: string, value: string) => values.set(key, value) } as Storage
    const legacy = openLegacyLocalStorageImportDatabase(storage)
    expect(await legacy.list()).toEqual([{ key: 'manta:theme', value: '{"themeId":"x"}' }])
    await legacy.remove(['manta:theme'])
    expect([...values.keys()]).toEqual(['unrelated'])
  })
})
