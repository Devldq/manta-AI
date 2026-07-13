import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { migrateLegacyRagStaging, openLegacyRagStagingDatabase } from './legacy-rag-staged-migration'

async function putLegacyFile(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite')
    transaction.objectStore('files').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function putLegacyMeta(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('meta', 'readwrite')
    transaction.objectStore('meta').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function makeDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('files'); request.result.createObjectStore('meta') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

describe('legacy RAG staged IndexedDB migration', () => {
  it('uploads each legacy File, verifies the canonical response, and deletes only that exact record', async () => {
    const name = `manta-rag-staged-${crypto.randomUUID()}`
    const database = await makeDatabase(name)
    await putLegacyFile(database, 'one', { id: 'one', kbId: 'kb-a', file: new File(['first'], 'first.txt', { type: 'text/plain' }), name: 'first.txt', size: 5, type: 'text/plain' })
    await putLegacyFile(database, 'two', { id: 'two', kbId: 'kb-a', file: new File(['second'], 'second.txt', { type: 'text/plain' }), name: 'second.txt', size: 6, type: 'text/plain' })
    database.close()

    const uploaded: string[] = []
    await migrateLegacyRagStaging({
      database: await openLegacyRagStagingDatabase(name),
      upload: async ({ file }) => { uploaded.push(file.name); return { canonical: file.name === 'first.txt' } },
    })

    expect(uploaded).toEqual(['first.txt', 'second.txt'])
    const reopened = await openLegacyRagStagingDatabase(name)
    expect((await reopened.listFiles()).map((entry) => entry.key)).toEqual(['two'])
    await reopened.close()
  })

  it('keeps legacy files and metadata while offline so a later startup retries them', async () => {
    const name = `manta-rag-staged-${crypto.randomUUID()}`
    const database = await makeDatabase(name)
    await putLegacyFile(database, 'retry', { id: 'retry', kbId: 'kb-a', file: new File(['retry'], 'retry.txt'), name: 'retry.txt', size: 5, type: 'text/plain' })
    database.close()
    const legacy = await openLegacyRagStagingDatabase(name)

    await expect(migrateLegacyRagStaging({ database: legacy, upload: async () => { throw new Error('offline') } })).resolves.toEqual({ migrated: 0, retained: 1 })
    expect((await legacy.listFiles()).map((entry) => entry.key)).toEqual(['retry'])
    await legacy.close()
  })

  it('preserves the historical meta-store chunking configuration in the canonical upload', async () => {
    const name = `manta-rag-staged-${crypto.randomUUID()}`
    const database = await makeDatabase(name)
    await putLegacyFile(database, 'with-meta', { id: 'with-meta', kbId: 'kb-a', file: new File(['meta'], 'meta.txt'), name: 'meta.txt', size: 4, type: 'text/plain' })
    await putLegacyMeta(database, 'kb-a', { kbId: 'kb-a', chunkingConfig: { strategy: 'fixed', chunkSize: 512, overlap: 32 } })
    database.close()

    let uploadedMeta: unknown
    const legacy = await openLegacyRagStagingDatabase(name)
    await migrateLegacyRagStaging({ database: legacy, upload: async (_file, metadata) => { uploadedMeta = metadata; return { canonical: true } } })
    await legacy.close()

    expect(uploadedMeta).toEqual({ kbId: 'kb-a', chunkingConfig: { strategy: 'fixed', chunkSize: 512, overlap: 32 } })
  })
})
