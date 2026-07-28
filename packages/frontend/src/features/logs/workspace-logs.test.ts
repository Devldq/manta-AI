import { describe, expect, it } from 'vitest'
import { filterWorkspaceLogs, groupWorkspaceLogs, mergeWorkspaceLogs } from './workspace-logs'
import type { WorkspaceLogEntry } from './types'

function entry(
  id: string,
  timestamp: string,
  overrides: Partial<WorkspaceLogEntry> = {},
): WorkspaceLogEntry {
  return {
    id,
    timestamp,
    level: 'info',
    type: 'system',
    source: 'server',
    message: id,
    ...overrides,
  }
}

describe('workspace log presentation model', () => {
  it('deduplicates incremental entries and keeps chronological cursor order', () => {
    const merged = mergeWorkspaceLogs(
      [entry('one', '2026-01-01T00:00:01.000Z')],
      [
        entry('one', '2026-01-01T00:00:01.000Z', { message: 'updated' }),
        entry('two', '2026-01-01T00:00:02.000Z'),
      ],
    )
    expect(merged.map((item) => item.id)).toEqual(['one', 'two'])
    expect(merged[0].message).toBe('updated')
  })

  it('filters safe display fields and groups entries by message step', () => {
    const entries = [
      entry('tool', '2026-01-01T00:00:03.000Z', {
        type: 'tool_call',
        message: 'Tool read_file completed',
        metadata: { messageId: 'message-1', stepIndex: 0 },
        details: { toolName: 'read_file' },
      }),
      entry('error', '2026-01-01T00:00:04.000Z', {
        level: 'error',
        message: 'Tool failed',
        metadata: { messageId: 'message-1', stepIndex: 0 },
      }),
      entry('session', '2026-01-01T00:00:01.000Z'),
    ]
    expect(filterWorkspaceLogs(entries, 'read_file', 'all', 'all').map((item) => item.id)).toEqual(['tool'])
    const groups = groupWorkspaceLogs(entries)
    expect(groups[0]).toMatchObject({ label: 'Step 1', errorCount: 1 })
    expect(groups[0].entries.map((item) => item.id)).toEqual(['error', 'tool'])
    expect(groups[1].label).toBe('会话事件')
  })
})
