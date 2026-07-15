/**
 * Imports the pre-ASH RAG queue once. Files are deliberately uploaded through
 * the normal multipart endpoint: the renderer never becomes a second durable
 * RAG store. A source row is removed only after that endpoint reports that the
 * document is canonical in ASH.
 */
export interface LegacyRagFile {
  id: string
  kbId: string
  file: File
  name: string
  size: number
  type: string
  relativePath?: string
}

export interface LegacyRagEntry { key: IDBValidKey; value: LegacyRagFile }
export interface LegacyRagBatchMeta { kbId: string; chunkingConfig?: { strategy?: string; chunkSize?: number; overlap?: number } }
export interface LegacyRagStagingDatabase {
  listFiles(): Promise<LegacyRagEntry[]>
  listMetadata(): Promise<LegacyRagBatchMeta[]>
  removeFile(key: IDBValidKey): Promise<void>
  close(): Promise<void>
}

export interface LegacyRagUpload { canonical: boolean }
export interface LegacyRagMigrationOptions {
  database: LegacyRagStagingDatabase
  upload(file: LegacyRagFile, metadata?: LegacyRagBatchMeta): Promise<LegacyRagUpload>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asLegacyFile(value: unknown): LegacyRagFile | undefined {
  // IndexedDB structured clone can restore a File as a Blob in older Chromium
  // and fake-indexeddb; the saved metadata supplies the original filename.
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kbId !== 'string' || !(value.file instanceof Blob) || typeof value.name !== 'string' || typeof value.size !== 'number' || typeof value.type !== 'string') return undefined
  const file = value.file instanceof File ? value.file : new File([value.file], value.name, { type: value.type })
  return { id: value.id, kbId: value.kbId, file, name: value.name, size: value.size, type: value.type, ...(typeof value.relativePath === 'string' ? { relativePath: value.relativePath } : {}) }
}

function transaction<T>(database: IDBDatabase, storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode)
    let output: T | undefined
    const request = operation(tx.objectStore(storeName))
    if (request) request.onsuccess = () => { output = request.result }
    tx.oncomplete = () => resolve(output)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Opens only the legacy stores. Missing/corrupt rows are retained for diagnosis. */
export function openLegacyRagStagingDatabase(name = 'manta-rag-staged', indexedDb: IDBFactory | undefined = globalThis.indexedDB): Promise<LegacyRagStagingDatabase> {
  if (!indexedDb) return Promise.reject(new Error('IndexedDB is unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      // Historical releases called this store `files`; do not create it when
      // absent, otherwise an empty database would look like a migrated one.
      if (!database.objectStoreNames.contains('files')) {
        database.close()
        resolve({ listFiles: async () => [], listMetadata: async () => [], removeFile: async () => {}, close: async () => {} })
        return
      }
      resolve({
        async listFiles() {
          const keys = await transaction<IDBValidKey[]>(database, 'files', 'readonly', (store) => store.getAllKeys()) ?? []
          const entries: LegacyRagEntry[] = []
          for (const key of keys) {
            const value = asLegacyFile(await transaction<unknown>(database, 'files', 'readonly', (store) => store.get(key)))
            if (value) entries.push({ key, value })
          }
          return entries
        },
        async listMetadata() {
          const storeName = database.objectStoreNames.contains('meta') ? 'meta' : database.objectStoreNames.contains('metadata') ? 'metadata' : database.objectStoreNames.contains('batchMeta') ? 'batchMeta' : undefined
          if (!storeName) return []
          const keys = await transaction<IDBValidKey[]>(database, storeName, 'readonly', (store) => store.getAllKeys()) ?? []
          const values = await Promise.all(keys.map((key) => transaction<unknown>(database, storeName, 'readonly', (store) => store.get(key))))
          return values.flatMap((value) => {
            if (!isRecord(value) || typeof value.kbId !== 'string') return []
            const config = isRecord(value.chunkingConfig) ? value.chunkingConfig : undefined
            return [{ kbId: value.kbId, ...(config ? { chunkingConfig: { ...(typeof config.strategy === 'string' ? { strategy: config.strategy } : {}), ...(typeof config.chunkSize === 'number' ? { chunkSize: config.chunkSize } : {}), ...(typeof config.overlap === 'number' ? { overlap: config.overlap } : {}) } } : {}) }]
          })
        },
        async removeFile(key) { await transaction(database, 'files', 'readwrite', (store) => store.delete(key)) },
        async close() { database.close() },
      })
    }
  })
}

/** Offline and partial failures are intentionally non-fatal and retry next start. */
export async function migrateLegacyRagStaging(options: LegacyRagMigrationOptions): Promise<{ migrated: number; retained: number }> {
  let migrated = 0
  let retained = 0
  const metadata = new Map((await options.database.listMetadata()).map((entry) => [entry.kbId, entry]))
  for (const entry of await options.database.listFiles()) {
    try {
      const result = await options.upload(entry.value, metadata.get(entry.value.kbId))
      if (!result.canonical) { retained += 1; continue }
      await options.database.removeFile(entry.key)
      migrated += 1
    } catch { retained += 1 }
  }
  return { migrated, retained }
}

function responseIsCanonical(response: unknown): boolean {
  if (!isRecord(response)) return false
  if (response.success === true && isRecord(response.data) && isRecord(response.data.document)) return true
  return response.type === 'done' && isRecord(response.document)
}

/** Production uploader used at startup; it accepts JSON and SSE done events. */
export async function uploadLegacyRagFile(file: LegacyRagFile, metadata?: LegacyRagBatchMeta, fetcher: typeof fetch = fetch): Promise<LegacyRagUpload> {
  const form = new FormData()
  form.append('file', file.file, file.name)
  form.append('migrationId', `legacy-rag-${file.id}`)
  if (metadata?.chunkingConfig?.strategy) form.append('chunkStrategy', metadata.chunkingConfig.strategy)
  if (metadata?.chunkingConfig?.chunkSize) form.append('chunkSize', String(metadata.chunkingConfig.chunkSize))
  if (metadata?.chunkingConfig?.overlap) form.append('chunkOverlap', String(metadata.chunkingConfig.overlap))
  const response = await fetcher(`/api/rag/knowledge-bases/${encodeURIComponent(file.kbId)}/documents`, { method: 'POST', body: form, headers: { 'X-Manta-Idempotency-Key': `legacy-rag-${file.id}` } })
  if (!response.ok) throw new Error(`Legacy RAG upload failed: HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) return { canonical: responseIsCanonical(await response.json()) }
  const body = await response.text()
  for (const line of body.split('\n')) if (line.startsWith('data: ')) {
    try { if (responseIsCanonical(JSON.parse(line.slice(6)))) return { canonical: true } } catch { /* keep source for retry */ }
  }
  return { canonical: false }
}
