import type { AshBootstrap, StorageGroupId } from '@manta/shared'
import { BootstrapStore } from '../bootstrap/bootstrap-store'
import { volumeRoot } from '../domain/invariants'
import { inventoryTree } from '../inventory/file-inventory'
import { MigrationCoordinator, type MigrationCoordinatorOptions } from '../migration/migration-coordinator'
import type { StorageGroupDriver } from '../migration/types'
import { VolumeRegistry } from '../registry/volume-registry'
import { StoragePathRouter } from '../router/path-router'
import { StorageLeaseManager } from './lease-manager'

export interface StorageHubResolver {
  resolve(group: StorageGroupId, ...segments: string[]): string
}

export async function createStorageHub(options: {
  bootstrap: AshBootstrap | BootstrapStore
  createDrivers?: (storage: StorageHubResolver) => Map<StorageGroupId, StorageGroupDriver>
} & Partial<Omit<MigrationCoordinatorOptions, 'store' | 'leases' | 'drivers'>> & { drivers?: Map<StorageGroupId, StorageGroupDriver> }) {
  const value = options.bootstrap instanceof BootstrapStore ? await options.bootstrap.read() : options.bootstrap
  if (!value) throw new Error('Bootstrap does not exist')
  const store = options.bootstrap instanceof BootstrapStore ? options.bootstrap : undefined
  const registry = new VolumeRegistry(value); const router = new StoragePathRouter(registry); const leases = new StorageLeaseManager()
  const base = {
    resolve: (group: StorageGroupId, ...segments: string[]) => router.resolve(group, ...segments),
    volumeFor: (group: StorageGroupId) => registry.volumeFor(group),
    inventory: async (scope?: { volumeId?: string; groupId?: StorageGroupId }) => {
      if (scope?.groupId) return inventoryTree(router.resolve(scope.groupId))
      const volume = scope?.volumeId ? value.volumes.find((item) => item.id === scope.volumeId) : value.volumes[0]
      if (!volume) throw new Error('Volume not found')
      return inventoryTree(volumeRoot(volume.parentPath))
    },
    acquireRead: (group: StorageGroupId) => leases.acquireRead(group), acquireWrite: (group: StorageGroupId) => leases.acquireWrite(group), leases,
  }
  const drivers = options.drivers ?? options.createDrivers?.(base)
  return {
    ...base,
    drivers,
    migrations: store && drivers ? new MigrationCoordinator({ ...options, store, leases, drivers } as MigrationCoordinatorOptions) : undefined,
  }
}
