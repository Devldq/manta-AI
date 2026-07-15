import { describe, expect, it } from 'vitest'
import { shouldTrackStorageProgress, trackedRecoveredMigrationKind } from './RecoveredMigrationKind'

describe('trackedRecoveredMigrationKind', () => {
  it('keeps internal imports out of user volume/group recovery bookkeeping', () => {
    expect(trackedRecoveredMigrationKind({ kind: 'volume' } as any)).toBe('volume')
    expect(trackedRecoveredMigrationKind({ kind: 'group' } as any)).toBe('group')
    expect(trackedRecoveredMigrationKind({ kind: 'import' } as any)).toBeUndefined()
  })

  it('keeps live import progress out of the volume/group operation catalog', () => {
    expect(shouldTrackStorageProgress({ operationKind: 'import' } as any)).toBe(false)
    expect(shouldTrackStorageProgress({ operationKind: 'group' } as any)).toBe(true)
    expect(shouldTrackStorageProgress({} as any)).toBe(true)
  })
})
