import { z } from 'zod'
import { STORAGE_GROUP_IDS } from './constants'
import type { StorageGroupId } from './constants'

export type { StorageGroupId } from './constants'

const TimestampSchema = z.iso.datetime()
export const StorageGroupIdSchema = z.enum(STORAGE_GROUP_IDS)

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

export const StorageIpcRequestSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('storage:select-parent'), purpose: z.enum(['createVolume', 'migrateVolume']) }),
  z.object({ channel: z.literal('storage:create-volume'), selectionId: z.string().min(1), name: z.string().min(1) }),
  z.object({ channel: z.literal('storage:relocate-volume'), volumeId: z.string().min(1), selectionId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:move-group'), groupId: StorageGroupIdSchema, targetVolumeId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:configure-git'), volumeId: z.string().min(1), remoteUrl: z.string().min(1), authRef: z.string().min(1).optional() }),
  z.object({ channel: z.literal('storage:sync-volume'), volumeId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:delete-backup'), backupId: z.string().min(1) }),
  z.object({ channel: z.literal('storage:open-volume'), volumeId: z.string().min(1) }),
])

export const StorageIpcResponseSchema = z.union([
  z.object({ ok: z.literal(true), kind: z.literal('parent-selected'), selectionId: z.string().min(1).optional() }),
  z.object({ ok: z.literal(true), kind: z.literal('volume-created'), volumeId: z.string().min(1) }),
  z.object({ ok: z.literal(true), kind: z.literal('operation-started'), operationId: z.string().min(1) }),
  z.object({ ok: z.literal(true), kind: z.literal('completed') }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string().min(1), message: z.string().min(1), details: z.record(z.string(), z.unknown()).optional() }) }),
])

export type StorageIpcRequest = z.infer<typeof StorageIpcRequestSchema>
export type StorageIpcResponse = z.infer<typeof StorageIpcResponseSchema>
