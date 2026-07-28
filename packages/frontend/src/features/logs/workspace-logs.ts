import type {
  WorkspaceLogEntry,
  WorkspaceLogGroup,
  WorkspaceLogLevelFilter,
} from './types'

export const MAX_WORKSPACE_LOGS = 500

export function mergeWorkspaceLogs(
  current: WorkspaceLogEntry[],
  incoming: WorkspaceLogEntry[],
  replace = false,
): WorkspaceLogEntry[] {
  const byId = new Map<string, WorkspaceLogEntry>()
  for (const entry of replace ? [] : current) byId.set(entry.id, entry)
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-MAX_WORKSPACE_LOGS)
}

export function filterWorkspaceLogs(
  entries: WorkspaceLogEntry[],
  search: string,
  level: WorkspaceLogLevelFilter,
  type: string,
): WorkspaceLogEntry[] {
  const needle = search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (level !== 'all' && entry.level !== level) return false
    if (type !== 'all' && entry.type !== type) return false
    if (!needle) return true
    const haystack = [
      entry.message,
      entry.type,
      entry.source,
      ...(entry.tags ?? []),
      JSON.stringify(entry.details ?? {}),
    ].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

export function groupWorkspaceLogs(entries: WorkspaceLogEntry[]): WorkspaceLogGroup[] {
  const groups = new Map<string, WorkspaceLogGroup>()
  for (const entry of entries) {
    const stepIndex = typeof entry.metadata?.stepIndex === 'number' ? entry.metadata.stepIndex : undefined
    const messageId = typeof entry.metadata?.messageId === 'string' ? entry.metadata.messageId : undefined
    const key = stepIndex === undefined ? 'session' : `${messageId ?? 'conversation'}:${stepIndex}`
    const existing = groups.get(key)
    if (existing) {
      existing.entries.push(entry)
      if (entry.timestamp > existing.latestAt) existing.latestAt = entry.timestamp
      if (entry.level === 'error' || entry.level === 'fatal') existing.errorCount++
      continue
    }
    groups.set(key, {
      key,
      label: stepIndex === undefined ? '会话事件' : `Step ${stepIndex + 1}`,
      stepIndex,
      messageId,
      latestAt: entry.timestamp,
      entries: [entry],
      errorCount: entry.level === 'error' || entry.level === 'fatal' ? 1 : 0,
    })
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    }))
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt))
}
