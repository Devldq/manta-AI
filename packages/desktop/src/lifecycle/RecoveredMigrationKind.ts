import type { MigrationJournal, StorageOperationProgress } from '@manta/shared'

export function trackedRecoveredMigrationKind(journal: Pick<MigrationJournal, 'kind'>): 'volume' | 'group' | undefined {
  return journal.kind === 'volume' || journal.kind === 'group' ? journal.kind : undefined
}

export function shouldTrackStorageProgress(progress: Pick<StorageOperationProgress, 'operationKind'>): boolean {
  return progress.operationKind !== 'import'
}
