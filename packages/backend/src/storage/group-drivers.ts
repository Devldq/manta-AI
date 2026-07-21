import { inventoryTree, type StorageGroupDriver } from '@manta/storage-hub'
import type { StorageGroupId } from '@manta/shared'
import type { EmbeddingCacheManager, QdrantProvider } from '@manta/rag'
import { EmbeddingCacheManager as Cache, QdrantProvider as Provider } from '@manta/rag'
import { join } from 'node:path'

async function allSettledOrThrow(label: string, operations: Array<() => void | Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)))
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${label}: ${errors.map(String).join('; ')}`)
}

async function lifecycleThenResources(
  label: string,
  lifecycleOperation: (() => void | Promise<void>) | undefined,
  resourceOperations: Array<() => void | Promise<void>>,
): Promise<void> {
  const errors: unknown[] = []
  if (lifecycleOperation) {
    try { await lifecycleOperation() } catch (error) { errors.push(error) }
  }
  const results = await Promise.allSettled(resourceOperations.map((operation) => Promise.resolve().then(operation)))
  for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${label}: ${errors.map(String).join('; ')}`)
}

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
  reopen(root: string): void | Promise<void>
  dispose(): void | Promise<void>
}

export function createGroupDriver(id: StorageGroupId, resources: ManagedResource[] = [], lifecycle?: ManagedGroupLifecycle): StorageGroupDriver {
  return {
    id,
    async quiesce() { await lifecycle?.quiesce() },
    async checkpoint() {
      await lifecycleThenResources(
        `${id} checkpoint failed`,
        lifecycle ? () => lifecycle.checkpoint() : undefined,
        resources.map((resource) => () => resource.checkpoint()),
      )
    },
    async close() {
      await lifecycleThenResources(
        `${id} close failed`,
        lifecycle ? () => lifecycle.close() : undefined,
        resources.map((resource) => () => resource.close()),
      )
    },
    async validate(root) {
      const results = await Promise.allSettled(resources.map((resource) => Promise.resolve().then(() => resource.integrityCheck())))
      const errors: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') errors.push(result.reason)
        else if (!result.value.ok) errors.push(new Error(result.value.error ?? `${id} integrity check failed`))
      }
      if (errors.length) return { ok: false, error: errors.map(String).join('; ') }
      try { await inventoryTree(root); return { ok: true } } catch (error) { return { ok: false, error: String(error) } }
    },
    async reopen(root) {
      const errors: unknown[] = []
      try { await allSettledOrThrow(`${id} resource reopen failed`, resources.map((resource) => () => resource.reopen(root))) }
      catch (error) { errors.push(...error instanceof AggregateError ? error.errors : [error]) }
      if (lifecycle) {
        try { await lifecycle.reopen(root) } catch (error) { errors.push(error) }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, `${id} reopen failed: ${errors.map(String).join('; ')}`)
    },
    inventory: inventoryTree,
  }
}

export interface KnowledgeCandidateFactory {
  provider(root: string): QdrantProvider
  cache(root: string): EmbeddingCacheManager
}

export function createKnowledgeDriver(
  provider: QdrantProvider,
  cache: EmbeddingCacheManager,
  candidates: KnowledgeCandidateFactory = {
    provider: (_root) => new Provider(),
    cache: (root) => new Cache(root),
  },
  resources: ManagedResource[] = [],
): StorageGroupDriver {
  return {
    id: 'knowledge',
    async quiesce() {},
    async checkpoint() { await allSettledOrThrow('Knowledge checkpoint failed', [() => provider.checkpoint(), () => cache.checkpoint(), ...resources.map((resource) => () => resource.checkpoint())]) },
    async close() { await allSettledOrThrow('Knowledge close failed', [() => provider.close(), () => cache.close(), ...resources.map((resource) => () => resource.close())]) },
    async validate(root) {
      const candidateProvider = candidates.provider(join(root, 'rag'))
      const candidateCache = candidates.cache(join(root, 'rag', 'cache'))
      const errors: unknown[] = []
      try {
        const results = await Promise.allSettled([candidateProvider.integrityCheck(), Promise.resolve().then(() => candidateCache.integrityCheck())])
        for (const result of results) {
          if (result.status === 'rejected') errors.push(result.reason)
          else if (!result.value.ok) errors.push(new Error(result.value.error ?? 'Knowledge integrity check failed'))
        }
      } finally {
        const closes = await Promise.allSettled([candidateProvider.close(), Promise.resolve().then(() => candidateCache.close())])
        for (const result of closes) if (result.status === 'rejected') errors.push(result.reason)
      }
      return errors.length ? { ok: false, error: `Knowledge validation failed: ${errors.map(String).join('; ')}` } : { ok: true }
    },
    async reopen(root) { await allSettledOrThrow('Knowledge reopen failed', [() => provider.reopen(join(root, 'rag')), () => cache.reopen(join(root, 'rag', 'cache')), ...resources.map((resource) => () => resource.reopen(root))]) },
    inventory: inventoryTree,
  }
}
