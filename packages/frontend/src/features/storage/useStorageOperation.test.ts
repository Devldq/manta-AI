import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectResumableStorageOperation } from './useStorageOperation'

describe('storage operation reconnect', () => {
  it('reconnects a reloaded renderer to the authoritative running catalog operation', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'older', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'migrating', phase: 'copying', status: 'running', updatedAt: '2026-01-01T00:00:01.000Z' },
    ])
    expect(selected?.id).toBe('migrating')
  })

  it('retains the renderer operation id when the catalog still contains it', () => {
    const selected = selectResumableStorageOperation('selected', [
      { id: 'newer', phase: 'copying', status: 'running' },
      { id: 'selected', phase: 'relaunching', status: 'running' },
    ])
    expect(selected?.id).toBe('selected')
  })

  it('does not resurrect a historic terminal operation when no renderer operation is active', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'failed-yesterday', phase: 'failed', status: 'failed', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'completed-yesterday', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:01.000Z' },
    ])

    expect(selected).toBeUndefined()
  })

  it('retains the current renderer operation long enough to report its terminal result', () => {
    const selected = selectResumableStorageOperation('selected', [
      { id: 'selected', phase: 'completed', status: 'succeeded' },
    ])

    expect(selected?.status).toBe('succeeded')
  })

  it.each([
    ['completed', 'succeeded'],
    ['failed', 'failed'],
  ] as const)('recovers the latest renderer-owned %s operation after a relaunch', (phase, status) => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'latest-owned', phase, status, updatedAt: '2026-01-01T00:00:02.000Z' },
      { id: 'older', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:01.000Z' },
    ], { ownedId: 'latest-owned' })

    expect(selected?.id).toBe('latest-owned')
    expect(selected?.status).toBe(status)
  })

  it('does not recover an owned terminal operation once a newer operation exists', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'newer', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:02.000Z' },
      { id: 'older-owned', phase: 'failed', status: 'failed', updatedAt: '2026-01-01T00:00:01.000Z' },
    ], { ownedId: 'older-owned' })

    expect(selected).toBeUndefined()
  })

  it('prefers the latest active operation over an owned terminal result', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'owned-terminal', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:02.000Z' },
      { id: 'running', phase: 'copying', status: 'running', updatedAt: '2026-01-01T00:00:03.000Z' },
    ], { ownedId: 'owned-terminal' })

    expect(selected?.id).toBe('running')
  })

  it('recovers the latest terminal operation once when it completed inside the renderer relaunch window', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'just-completed', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:02.000Z' },
      { id: 'older', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:01.000Z' },
    ], { terminalUpdatedAfter: '2026-01-01T00:00:01.500Z' })

    expect(selected?.id).toBe('just-completed')
  })

  it('does not recover the latest terminal operation when it predates the relaunch window', () => {
    const selected = selectResumableStorageOperation(undefined, [
      { id: 'historic', phase: 'completed', status: 'succeeded', updatedAt: '2026-01-01T00:00:01.000Z' },
    ], { terminalUpdatedAfter: '2026-01-01T00:00:01.001Z' })

    expect(selected).toBeUndefined()
  })

  it('keeps ownership in the renderer lifecycle and never creates a second browser persistence source', () => {
    const source = readFileSync(new URL('./useStorageOperation.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('localStorage')
    expect(source).toMatch(/begin\(id: string\)[\s\S]*rendererOwnedOperationId = id/)
    expect(source).toMatch(/resume\([\s\S]*terminalUpdatedAfter[\s\S]*terminalRecoveryConsumed = true/)
  })

  it('clears a transient polling error after the authoritative operation request recovers', () => {
    const source = readFileSync(new URL('./useStorageOperation.ts', import.meta.url), 'utf8')

    expect(source).toMatch(/setOperation\(next\)\s*setError\(undefined\)/)
  })
})
