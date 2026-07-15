import { join } from 'node:path'
import { z } from 'zod'
import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'

const hash = z.string().regex(/^[a-f0-9]{64}$/)

/** The versioned, credential-free description committed with each volume snapshot. */
export const SyncManifestSchema = z.object({
  schemaVersion: z.literal(1),
  volumeId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  groupHashes: z.record(z.string(), hash).refine(
    (groups) => Object.keys(groups).every((group) => STORAGE_GROUP_IDS.includes(group as StorageGroupId) && !['diagnostics', 'cache'].includes(group)),
    'Sync manifest contains an unsupported storage group',
  ),
  createdAt: z.string().datetime(),
}).strict()
export type SyncManifest = z.infer<typeof SyncManifestSchema> & { groupHashes: Partial<Record<StorageGroupId, string>> }

export const syncManifestPath = (snapshotRoot: string) => join(snapshotRoot, 'ash-sync-manifest.json')
