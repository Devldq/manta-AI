import { describe, expect, it } from 'vitest'
import { reconcileExpandedWorkspaceIds, type WorkspaceSummary } from './workspace-store'

function workspace(id: string): WorkspaceSummary {
  return {
    id,
    name: id,
    conversationCount: 0,
    createdAt: '',
    updatedAt: '',
  }
}

describe('reconcileExpandedWorkspaceIds', () => {
  it('expands every project on the initial load', () => {
    const result = reconcileExpandedWorkspaceIds(
      [],
      new Set(),
      [workspace('alpha'), workspace('beta')],
    )

    expect([...result]).toEqual(['alpha', 'beta'])
  })

  it('preserves manual collapse while expanding newly added projects', () => {
    const result = reconcileExpandedWorkspaceIds(
      [workspace('alpha'), workspace('beta')],
      new Set(['beta']),
      [workspace('alpha'), workspace('beta'), workspace('gamma')],
    )

    expect([...result]).toEqual(['beta', 'gamma'])
  })

  it('removes expansion state for deleted projects', () => {
    const result = reconcileExpandedWorkspaceIds(
      [workspace('alpha'), workspace('beta')],
      new Set(['alpha', 'beta']),
      [workspace('beta')],
    )

    expect([...result]).toEqual(['beta'])
  })
})
