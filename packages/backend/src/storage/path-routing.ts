import { AsyncLocalStorage } from 'node:async_hooks'
import type { StorageGroupId } from '@manta/shared'

export interface StoragePathResolver {
  resolve(group: StorageGroupId, ...segments: string[]): string
}

const storageContext = new AsyncLocalStorage<StoragePathResolver>()

/** Run application persistence in the scope of one initialized ASH router. */
export function runWithStorageResolver<T>(resolver: StoragePathResolver, operation: () => T): T {
  return storageContext.run(resolver, operation)
}

/** Resolve an application-owned path. There is deliberately no home/cwd fallback. */
export function resolveStoragePath(group: StorageGroupId, ...segments: string[]): string {
  const resolver = storageContext.getStore()
  if (!resolver) throw new Error('ASH storage resolver is not available in the current operation')
  return resolver.resolve(group, ...segments)
}

export function getStorageResolver(): StoragePathResolver {
  const resolver = storageContext.getStore()
  if (!resolver) throw new Error('ASH storage resolver is not available in the current operation')
  return resolver
}
