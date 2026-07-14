import { z } from 'zod'
import { STORAGE_GROUP_IDS } from './constants'
import type { StorageGroupId } from './constants'

export type { StorageGroupId } from './constants'

const TimestampSchema = z.iso.datetime()
export const StorageGroupIdSchema = z.enum(STORAGE_GROUP_IDS)

export const StorageCapacityBlockerSchema = z.object({
  code: z.string().min(1),
  path: z.string().min(1).optional(),
  detail: z.string().min(1),
})
export type StorageCapacityBlocker = z.infer<typeof StorageCapacityBlockerSchema>

const CapacityFieldsSchema = z.object({
  scanStatus: z.enum(['complete', 'degraded', 'scanning']),
  logicalImmutableBytes: z.number().int().nonnegative(),
  physicalImmutableBytes: z.number().int().nonnegative().nullable(),
  verifiedDedupSavedBytes: z.number().int().nonnegative().nullable(),
  replicaBytes: z.number().int().nonnegative(),
  cleanableBytes: z.number().int().nonnegative().nullable(),
  scannedAt: TimestampSchema,
  blockers: z.array(StorageCapacityBlockerSchema),
}).superRefine((value, context) => {
  if (value.scanStatus !== 'complete' && (value.physicalImmutableBytes !== null || value.verifiedDedupSavedBytes !== null)) {
    context.addIssue({ code: 'custom', message: 'Unverified scans cannot report physical bytes or savings' })
  }
})

export const StorageCapacityMetricsSchema = CapacityFieldsSchema.safeExtend({ volumeId: z.string().min(1) })
export const AggregateStorageCapacityMetricsSchema = CapacityFieldsSchema
export type StorageVolumeCapacityMetrics = z.infer<typeof StorageCapacityMetricsSchema>
export type AggregateStorageCapacityMetrics = z.infer<typeof AggregateStorageCapacityMetricsSchema>

function capacitySum(values: number[]): number | null {
  let total = 0
  for (const value of values) { total += value; if (!Number.isSafeInteger(total)) return null }
  return total
}

export function aggregateStorageCapacityMetrics(volumes: StorageVolumeCapacityMetrics[]): AggregateStorageCapacityMetrics {
  const status = volumes.some((item) => item.scanStatus === 'scanning') ? 'scanning' : volumes.every((item) => item.scanStatus === 'complete') ? 'complete' : 'degraded'
  const logical = capacitySum(volumes.map((item) => item.logicalImmutableBytes)) ?? 0
  const replicas = capacitySum(volumes.map((item) => item.replicaBytes)) ?? 0
  const physical = status === 'complete' && volumes.every((item) => item.physicalImmutableBytes !== null) ? capacitySum(volumes.map((item) => item.physicalImmutableBytes!)) : null
  const cleanable = volumes.every((item) => item.cleanableBytes !== null) ? capacitySum(volumes.map((item) => item.cleanableBytes!)) : null
  const scannedAt = volumes.map((item) => item.scannedAt).sort().at(-1) ?? new Date(0).toISOString()
  return { scanStatus: status, logicalImmutableBytes: logical, physicalImmutableBytes: physical, verifiedDedupSavedBytes: status === 'complete' && physical !== null ? Math.max(0, logical - physical) : null, replicaBytes: replicas, cleanableBytes: cleanable, scannedAt, blockers: volumes.flatMap((item) => item.blockers) }
}

export interface StorageVolumeRecord {
  id: string
  name: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

export const StorageVolumeRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentPath: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type MigrationPhase =
  | 'planned'
  | 'quiescing'
  | 'copying'
  | 'validating'
  | 'committing'
  | 'restarting'
  | 'verifying'
  | 'completed'
  | 'rolling-back'
  | 'failed'

export const MigrationPhaseSchema = z.enum([
  'planned', 'quiescing', 'copying', 'validating', 'committing', 'restarting',
  'verifying', 'completed', 'rolling-back', 'failed',
])

export interface MigrationJournal {
  id: string
  kind: 'volume' | 'group'
  sourceVolumeId: string
  targetVolumeId?: string
  targetParentPath?: string
  groups: StorageGroupId[]
  sourceGeneration: number
  targetGeneration: number
  phase: MigrationPhase
  filesCompleted: number
  filesTotal: number
  bytesCompleted: number
  bytesTotal: number
  manifestDigest?: string
  error?: string
  rollbackPath?: string
}

export const MigrationJournalSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['volume', 'group']),
  sourceVolumeId: z.string().min(1),
  targetVolumeId: z.string().min(1).optional(),
  targetParentPath: z.string().min(1).optional(),
  groups: z.array(StorageGroupIdSchema).min(1),
  sourceGeneration: z.number().int().nonnegative(),
  targetGeneration: z.number().int().nonnegative(),
  phase: MigrationPhaseSchema,
  filesCompleted: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative(),
  bytesCompleted: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  manifestDigest: z.string().min(1).optional(),
  error: z.string().optional(),
  rollbackPath: z.string().min(1).optional(),
})

export interface AshLocationSnapshot {
  generation: number
  volumes: StorageVolumeRecord[]
  groupAssignments: Record<StorageGroupId, string>
}

export const StorageGroupAssignmentsSchema = z.object(
  Object.fromEntries(STORAGE_GROUP_IDS.map((group) => [group, z.string().min(1)])) as {
    [K in StorageGroupId]: z.ZodString
  },
)

export const AshLocationSnapshotSchema = z.object({
  generation: z.number().int().nonnegative(),
  volumes: z.array(StorageVolumeRecordSchema).min(1),
  groupAssignments: StorageGroupAssignmentsSchema,
})

export interface AshBootstrap extends AshLocationSnapshot {
  schemaVersion: 1
  previous?: AshLocationSnapshot
  pendingMigration?: MigrationJournal
}

export const AshBootstrapSchema = AshLocationSnapshotSchema.extend({
  schemaVersion: z.literal(1),
  previous: AshLocationSnapshotSchema.optional(),
  pendingMigration: MigrationJournalSchema.optional(),
})

export interface StorageOperationProgress {
  operationId: string
  phase: string
  currentGroup?: StorageGroupId
  filesCompleted: number
  filesTotal: number
  bytesCompleted: number
  bytesTotal: number
  message: string
}

export const StorageOperationProgressSchema = z.object({
  operationId: z.string().min(1),
  phase: z.string().min(1),
  currentGroup: StorageGroupIdSchema.optional(),
  filesCompleted: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative(),
  bytesCompleted: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  message: z.string(),
})

/** A credential-free remote accepted by the privileged storage IPC surface. */
export const GitRemoteUrlSchema = z.string().min(1).superRefine((value, context) => {
  if (/\s|@|[?#]/.test(value) || /(?:token|secret|password|credential|key)=?/i.test(value)) {
    context.addIssue({ code: 'custom', message: 'Git remote URL must not include credentials, query, or fragment' })
    return
  }
  try {
    const parsed = new URL(value)
    if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) context.addIssue({ code: 'custom', message: 'Git remote URL is invalid' })
  } catch { context.addIssue({ code: 'custom', message: 'Git remote URL is invalid' }) }
})
export const GitCredentialRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/, 'Git credential reference is invalid')
export const StorageGitBindingSchema = z.object({
  volumeId: z.string().min(1),
  mode: z.enum(['local', 'remote']),
  remoteUrl: GitRemoteUrlSchema.optional(),
  credentialRef: GitCredentialRefSchema.optional(),
  lastSyncedGroupHashes: z.record(StorageGroupIdSchema, z.string().regex(/^[a-f0-9]{64}$/)).optional(),
  lastSyncedAt: z.string().datetime().optional(),
  lastSyncStatus: z.literal('succeeded').optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

/** A deliberate, group-level decision for a validated remote Git snapshot. */
// Imports are whole-group replacements.  Asset-level duplication would require
// a separately validated immutable-asset format; do not advertise a no-op
// choice until that format exists.
export const StorageImportChoiceSchema = z.enum(['keep-local', 'keep-remote'])
export const StorageGroupConflictStateSchema = z.enum(['unchanged', 'local-only', 'remote-only', 'remote-addition', 'conflict', 'database-conflict'])
export const StorageGitImportGroupSchema = z.object({
  group: StorageGroupIdSchema,
  state: StorageGroupConflictStateSchema,
  choices: z.array(StorageImportChoiceSchema).min(1),
  defaultChoice: StorageImportChoiceSchema,
})
export const StorageGitImportPlanSchema = z.object({
  volumeId: z.string().min(1),
  sessionId: z.string().min(1),
  groups: z.array(StorageGitImportGroupSchema),
  requiresConfirmation: z.boolean(),
})

export const StorageIpcRequestSchema = z.union([
  z.object({ channel: z.literal('storage:select-parent'), purpose: z.enum(['createVolume', 'migrateVolume']) }),
  z.object({ channel: z.literal('storage:create-volume'), selectionId: z.string().min(1), name: z.string().min(1) }),
  z.object({ channel: z.literal('storage:relocate-volume'), volumeId: z.string().min(1), selectionId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:move-group'), groupId: StorageGroupIdSchema, targetVolumeId: z.string().min(1) }),
  z.union([
    z.object({ channel: z.literal('storage:configure-git'), volumeId: z.string().min(1), mode: z.literal('local') }),
    z.object({ channel: z.literal('storage:configure-git'), volumeId: z.string().min(1), mode: z.literal('remote'), remoteUrl: GitRemoteUrlSchema, authRef: GitCredentialRefSchema.optional() }),
  ]),
  z.object({ channel: z.literal('storage:sync-volume'), volumeId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:plan-git-import'), volumeId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:apply-git-import'), volumeId: z.string().min(1), sessionId: z.string().min(1), decisions: z.partialRecord(StorageGroupIdSchema, StorageImportChoiceSchema) }),
  z.object({ channel: z.literal('storage:delete-backup'), backupId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:open-volume'), volumeId: z.string().min(1) }),
])

export const StorageIpcResponseSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal('parent-selected'), selectionId: z.string().min(1).optional() }),
  z.object({ ok: z.literal(true), kind: z.literal('volume-created'), volumeId: z.string().min(1) }),
  z.object({ ok: z.literal(true), kind: z.literal('operation-started'), operationId: z.string().min(1) }),
  z.object({ ok: z.literal(true), kind: z.literal('git-configured'), binding: StorageGitBindingSchema }),
  z.object({ ok: z.literal(true), kind: z.literal('completed') }),
  z.object({ ok: z.literal(true), kind: z.literal('git-import-plan'), plan: StorageGitImportPlanSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string().min(1), message: z.string().min(1), details: z.record(z.string(), z.unknown()).optional() }) }),
])

export type StorageIpcRequest = z.infer<typeof StorageIpcRequestSchema>
export type StorageIpcResponse = z.infer<typeof StorageIpcResponseSchema>
export type StorageGitImportPlan = z.infer<typeof StorageGitImportPlanSchema>
