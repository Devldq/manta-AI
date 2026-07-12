/**
 * One-way browser cache importer. Browser records are intentionally a recovery
 * source only; the backend's ASH config/cache stores become canonical before
 * this importer removes any browser copy.
 */
export interface BrowserStorageDatabase {
  list(): Promise<Array<{ key: string; value: unknown }>>
  remove(keys: string[]): Promise<void>
}

export interface BrowserStorageImporterOptions {
  database: BrowserStorageDatabase
  persist(records: Record<string, unknown>): Promise<void>
  manifestKeys?: { current: string; previous: string }
}

const DEFAULT_MANIFEST_KEYS = { current: '__ash_manifest_current__', previous: '__ash_manifest_previous__' }
interface BrowserManifest { version: 4; records: Record<string, unknown> }

function parseManifest(value: unknown): BrowserManifest | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value)
    if (parsed?.version === 4 && parsed.records && typeof parsed.records === 'object') return parsed
  } catch { /* recover from previous manifest below */ }
  return undefined
}

export function createBrowserStorageImporter(options: BrowserStorageImporterOptions) {
  let inFlight: Promise<void> | undefined
  const keys = options.manifestKeys ?? DEFAULT_MANIFEST_KEYS
  async function perform(): Promise<void> {
    const entries = await options.database.list()
    const byKey = new Map(entries.map((entry) => [entry.key, entry.value]))
    const current = parseManifest(byKey.get(keys.current))
    const previous = parseManifest(byKey.get(keys.previous))
    // A v4 manifest snapshots an atomic browser-side transaction. If current
    // was interrupted/corrupted, previous is the only recoverable candidate.
    const manifest = current ?? previous
    const records = manifest?.records ?? Object.fromEntries(
      entries
        .filter(({ key }) => key !== keys.current && key !== keys.previous)
        .map(({ key, value }) => [key, value]),
    )
    if (Object.keys(records).length === 0) return
    await options.persist(records)
    const recordKeys = manifest ? [...Object.keys(records), keys.current, keys.previous] : Object.keys(records)
    await options.database.remove(recordKeys)
  }
  return {
    importOnce(): Promise<void> {
      if (!inFlight) inFlight = perform().finally(() => { inFlight = undefined })
      return inFlight
    },
  }
}

/**
 * Compatibility reader for browser records created before ASH. Version 4 is
 * deliberately separate from live app data: it stores only an atomic current /
 * previous manifest, never conversation or file content as canonical state.
 */
export function openBrowserStorageImportDatabase(name = 'manta-ash-browser-import', indexedDb: IDBFactory | undefined = globalThis.indexedDB): Promise<BrowserStorageDatabase> {
  if (!indexedDb) return Promise.reject(Object.assign(new Error('IndexedDB is unavailable'), { code: 'BROWSER_STORAGE_UNAVAILABLE' }))
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, 4)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records') }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T> | void) => new Promise<T | undefined>((done, fail) => {
        const tx = database.transaction('records', mode); let result: T | undefined
        const output = operation(tx.objectStore('records'))
        if (output) output.onsuccess = () => { result = output.result }
        tx.oncomplete = () => done(result); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error)
      })
      resolve({
        async list() { const keys = await transaction<IDBValidKey[]>('readonly', (store) => store.getAllKeys()) ?? []; const values = await Promise.all(keys.map(async (key) => ({ key: String(key), value: await transaction<unknown>('readonly', (store) => store.get(key)) }))); return values },
        async remove(keys) { await transaction('readwrite', (store) => { for (const key of keys) store.delete(key) }) },
      })
    }
  })
}

export async function openBrowserStorageImportDatabaseWithFallback(name?: string): Promise<{ database: BrowserStorageDatabase; persistent: boolean }> {
  try { return { database: await openBrowserStorageImportDatabase(name), persistent: true } } catch {
    const values = new Map<string, unknown>()
    return { database: { list: async () => [...values.entries()].map(([key, value]) => ({ key, value })), remove: async (keys) => { for (const key of keys) values.delete(key) } }, persistent: false }
  }
}
