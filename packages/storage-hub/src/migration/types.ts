import type { StorageGroupId, StorageOperationProgress } from '@manta/shared'
import type { StorageInventory } from '../inventory/file-inventory'

export interface ValidationResult { ok: boolean; error?: string }
export interface StorageGroupDriver {
  id: StorageGroupId
  quiesce(): Promise<void>
  checkpoint(): Promise<void>
  close(): Promise<void>
  validate(root: string): Promise<ValidationResult>
  reopen(root: string): Promise<void>
  inventory(root: string): Promise<StorageInventory>
}
export type MigrationFaultPoint =
  | 'copying'
  | 'validating'
  | 'before-bootstrap-commit'
  | 'after-bootstrap-commit'
  | 'before-import-first-rename'
  | 'after-import-restarting-journal'
  | 'after-import-completed-journal'
  | `after-import-live-to-backup:${StorageGroupId}`
  | `after-import-staging-to-live:${StorageGroupId}`
export type ProgressHandler = (progress: StorageOperationProgress) => void
