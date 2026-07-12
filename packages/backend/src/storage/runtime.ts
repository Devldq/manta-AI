import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { EmbeddingCacheManager, configureSQLiteVecProvider, resetSQLiteVecProvider } from '@manta/rag'
import type { StorageGroupDriver } from '@manta/storage-hub'
import { createGroupDriver, createKnowledgeDriver } from './group-drivers'

export interface StorageResolver { resolve(group: StorageGroupId, ...segments: string[]): string }
export interface BackendStorageRuntime extends StorageResolver {
  readonly drivers?: Map<StorageGroupId, StorageGroupDriver>
  quiesce(): Promise<void>
  checkpoint(): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
}

export function createBackendStorageRuntime(storage: StorageResolver): BackendStorageRuntime {
  const provider = configureSQLiteVecProvider(storage.resolve('knowledge', 'rag'))
  const cache = new EmbeddingCacheManager(storage.resolve('knowledge', 'rag', 'cache'))
  const drivers = new Map<StorageGroupId, StorageGroupDriver>()
  for (const id of STORAGE_GROUP_IDS) drivers.set(id, id === 'knowledge' ? createKnowledgeDriver(provider, cache) : createGroupDriver(id))
  let quiesced = false
  let closed = false
  return {
    resolve: storage.resolve.bind(storage), drivers,
    async quiesce() { quiesced = true; await Promise.all([...drivers.values()].map((driver) => driver.quiesce())) },
    async checkpoint() { await Promise.all([...drivers.values()].map((driver) => driver.checkpoint())) },
    async close() {
      if (closed) return
      closed = true
      await Promise.all([...drivers.values()].map((driver) => driver.close()))
      await resetSQLiteVecProvider()
    },
    async healthCheck() {
      if (closed) return { ok: false, error: 'closed' }
      if (quiesced) return { ok: false, error: 'quiesced' }
      return provider.integrityCheck()
    },
  }
}
