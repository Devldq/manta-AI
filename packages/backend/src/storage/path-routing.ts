import { AsyncLocalStorage } from 'node:async_hooks'
import type { StorageGroupId } from '@manta/shared'

export interface StoragePathResolver {
  resolve(group: StorageGroupId, ...segments: string[]): string
  /** Rebuildable machine-local data that must never be routed to a cloud volume. */
  resolveLocalCache?(...segments: string[]): string
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

/** Resolve rebuildable machine-local cache data.
 * Tests and headless callers without an explicit local root retain the routed
 * cache-group fallback; Desktop Service always injects a true local root.
 */
export function resolveLocalCachePath(...segments: string[]): string {
  const resolver = storageContext.getStore()
  if (!resolver) throw new Error('ASH storage resolver is not available in the current operation')
  return resolver.resolveLocalCache?.(...segments) ?? resolver.resolve('cache', 'local', ...segments)
}

/** Validate one caller-controlled identifier before using it as a path segment. */
export function safeStorageSegment(value: string): string {
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
  if (!value || value === '.' || value === '..' || /[<>:"/\\|?*\u0000-\u001f]/u.test(value) || /[. ]$/u.test(value) || reserved.test(value)) {
    throw new Error('Unsafe storage path segment')
  }
  return value
}

export function getStorageResolver(): StoragePathResolver {
  const resolver = storageContext.getStore()
  if (!resolver) throw new Error('ASH storage resolver is not available in the current operation')
  return resolver
}
