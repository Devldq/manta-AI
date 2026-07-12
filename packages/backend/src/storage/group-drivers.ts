import { inventoryTree, type StorageGroupDriver } from '@manta/storage-hub'
import type { StorageGroupId } from '@manta/shared'
import type { EmbeddingCacheManager, SQLiteVecProvider } from '@manta/rag'
import { EmbeddingCacheManager as Cache, SQLiteVecProvider as Provider } from '@manta/rag'
import { join } from 'node:path'

export interface ManagedResource {
  checkpoint(): void | Promise<void>
  close(): void | Promise<void>
  integrityCheck(): { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  reopen(root: string): void | Promise<void>
}

export interface ManagedGroupLifecycle {
  quiesce(): void | Promise<void>
  checkpoint(): void | Promise<void>
  close(): void | Promise<void>
  reopen(): void | Promise<void>
  dispose(): void | Promise<void>
}

export function createGroupDriver(id: StorageGroupId, resources: ManagedResource[] = [], lifecycle?: ManagedGroupLifecycle): StorageGroupDriver {
  return {
    id,
    async quiesce() { await lifecycle?.quiesce() },
    async checkpoint() { await lifecycle?.checkpoint(); await Promise.all(resources.map((resource) => resource.checkpoint())) },
    async close() { await lifecycle?.close(); await Promise.all(resources.map((resource) => resource.close())) },
    async validate(root) {
      for (const resource of resources) {
        const result = await resource.integrityCheck()
        if (!result.ok) return result
      }
      try { await inventoryTree(root); return { ok: true } } catch (error) { return { ok: false, error: String(error) } }
    },
    async reopen(root) { await Promise.all(resources.map((resource) => resource.reopen(root))); await lifecycle?.reopen() },
    inventory: inventoryTree,
  }
}

export function createKnowledgeDriver(provider: SQLiteVecProvider, cache: EmbeddingCacheManager): StorageGroupDriver {
  return {
    id: 'knowledge',
    async quiesce() {},
    async checkpoint() { await provider.checkpoint(); cache.checkpoint() },
    async close() { await provider.close(); cache.close() },
    async validate(root) {
      const candidateProvider = new Provider(join(root, 'rag'))
      const candidateCache = new Cache(join(root, 'rag', 'cache'))
      try {
        const providerResult = await candidateProvider.integrityCheck()
        if (!providerResult.ok) return providerResult
        return candidateCache.integrityCheck()
      } catch (error) { return { ok: false, error: String(error) } }
      finally { await candidateProvider.close(); candidateCache.close() }
    },
    async reopen(root) { await provider.reopen(join(root, 'rag')); cache.reopen(join(root, 'rag', 'cache')) },
    inventory: inventoryTree,
  }
}
