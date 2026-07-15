import { describe, expect, it } from 'vitest'
import { AgentStorageProgressSchema, StorageIpcRequestSchema, StorageIpcResponseSchema } from './storage'

describe('Agent storage shared contracts', () => {
  it('accepts only opaque identifiers in strict privileged requests', () => {
    expect(StorageIpcRequestSchema.parse({ channel: 'storage:agent-plan-import', adapterId: 'codex', installationId: 'codex-user', assetIds: ['native-skill'] })).toEqual({ channel: 'storage:agent-plan-import', adapterId: 'codex', installationId: 'codex-user', assetIds: ['native-skill'] })
    for (const invalid of [
      { channel: 'storage:agent-plan-import', adapterId: 'codex', installationId: 'codex-user', nativePath: '/private' },
      { channel: 'storage:agent-plan-import', adapterId: 'codex', installationId: 'codex-user', assetIds: [] },
      { channel: 'storage:agent-plan-import', adapterId: 'codex', installationId: 'codex-user', assetIds: ['one', 'one'] },
      { channel: 'storage:agent-plan-projection', adapterId: 'codex', installationId: 'codex-user', assetIds: ['one', 'one'] },
      { channel: 'storage:agent-apply', planSessionId: '../plan' },
      { channel: 'storage:agent-rollback', operationId: 'operation', command: 'run' },
    ]) expect(StorageIpcRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it('validates sanitized previews, results, and deterministic progress', () => {
    const preview = { ok: true, kind: 'agent-plan' as const, plan: { planSessionId: 'session-1', kind: 'projection' as const, expiresAt: '2026-07-15T01:00:00.000Z', operations: [{ id: 'file-1', kind: 'create' as const, rootId: 'user-skills', nativePath: '/home/.agents/skills/a/SKILL.md', expectedAfterSha256: 'a'.repeat(64) }] } }
    expect(StorageIpcResponseSchema.parse(preview)).toEqual(preview)
    expect(StorageIpcResponseSchema.safeParse({ ...preview, plan: { ...preview.plan, approval: { digest: 'x' } } }).success).toBe(false)
    expect(AgentStorageProgressSchema.parse({ operationId: 'operation-1', phase: 'applying', status: 'running', operationsCompleted: 0, operationsTotal: 2 })).toEqual({ operationId: 'operation-1', phase: 'applying', status: 'running', operationsCompleted: 0, operationsTotal: 2 })
  })
})
