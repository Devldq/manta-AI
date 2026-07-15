import { STORAGE_GROUP_IDS, type StorageGroupId } from '@manta/shared'

export type ImportChoice = 'keep-local' | 'keep-remote'
export type GroupConflictState = 'unchanged' | 'local-only' | 'remote-only' | 'remote-addition' | 'conflict' | 'database-conflict'

export interface GroupConflictPlan {
  group: StorageGroupId
  state: GroupConflictState
  choices: ImportChoice[]
  defaultChoice: ImportChoice
}

export interface ConflictPlan { groups: GroupConflictPlan[]; requiresConfirmation: boolean }
type Hashes = Partial<Record<StorageGroupId, string>>
const DATABASE_GROUPS = new Set<StorageGroupId>(['knowledge'])

/** Plans only at storage-group granularity; database contents are never merged. */
export function planGroupConflicts(input: { base: Hashes; local: Hashes; remote: Hashes; includeSecrets?: boolean }): ConflictPlan {
  const groups: GroupConflictPlan[] = []
  for (const group of STORAGE_GROUP_IDS) {
    if (['diagnostics', 'cache'].includes(group) || (group === 'secrets' && !input.includeSecrets)) continue
    const base = input.base[group]; const local = input.local[group]; const remote = input.remote[group]
    if (local === remote) { if (local !== undefined) groups.push({ group, state: 'unchanged', choices: ['keep-local'], defaultChoice: 'keep-local' }); continue }
    if (base === undefined && local === undefined && remote !== undefined) { groups.push({ group, state: 'remote-addition', choices: ['keep-remote'], defaultChoice: 'keep-remote' }); continue }
    if (local === base && remote !== base) { groups.push({ group, state: 'remote-only', choices: ['keep-remote'], defaultChoice: 'keep-remote' }); continue }
    if (remote === base && local !== base) { groups.push({ group, state: 'local-only', choices: ['keep-local'], defaultChoice: 'keep-local' }); continue }
    const database = DATABASE_GROUPS.has(group)
    groups.push({ group, state: database ? 'database-conflict' : 'conflict', choices: ['keep-local', 'keep-remote'], defaultChoice: 'keep-local' })
  }
  return { groups, requiresConfirmation: groups.some((group) => group.state === 'conflict' || group.state === 'database-conflict') }
}
