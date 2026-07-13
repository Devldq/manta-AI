import { join } from 'node:path'
import { z } from 'zod'
import type { StorageGroupId } from '@manta/shared'

const hash = z.string().regex(/^[a-f0-9]{64}$/)

/** The versioned, credential-free description committed with each volume snapshot. */
export const SyncManifestSchema = z.object({
  schemaVersion: z.literal(1),
  volumeId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  groupHashes: z.record(z.string(), hash).refine((groups) => Object.keys(groups).every((group) => group !== 'secrets' && group !== 'diagnostics' && group !== 'cache')),
  createdAt: z.string().datetime(),
})
export type SyncManifest = z.infer<typeof SyncManifestSchema> & { groupHashes: Partial<Record<StorageGroupId, string>> }

export const syncManifestPath = (snapshotRoot: string) => join(snapshotRoot, 'ash-sync-manifest.json')
