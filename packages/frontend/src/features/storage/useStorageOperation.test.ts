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
})
