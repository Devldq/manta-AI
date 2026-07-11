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
export type MigrationFaultPoint = 'copying' | 'validating' | 'before-bootstrap-commit' | 'after-bootstrap-commit'
export type ProgressHandler = (progress: StorageOperationProgress) => void
