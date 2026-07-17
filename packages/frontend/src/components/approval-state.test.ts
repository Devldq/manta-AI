import { describe, expect, it } from 'vitest'
import {
  mergePendingApproval,
  removePendingApproval,
  replacePendingApprovals,
  type PendingApproval,
} from './approval-state'

const first: PendingApproval = {
  id: 'approval-1',
  type: 'read',
  path: '/outside/a.txt',
  requestedBy: 'conversation-a',
  createdAt: 1,
}

describe('approval queue state', () => {
  it('does not duplicate an approval replayed by the snapshot and SSE', () => {
    const replayed = { ...first, path: '/outside/a-renamed.txt' }

    expect(mergePendingApproval([first], replayed)).toEqual([replayed])
  })

  it('appends a newly received approval', () => {
    const second: PendingApproval = {
      id: 'approval-2',
      type: 'shell',
      command: 'echo safe',
      requestedBy: 'conversation-b',
      createdAt: 2,
    }

    expect(mergePendingApproval([first], second)).toEqual([first, second])
  })

  it('removes a resolved approval by id', () => {
    expect(removePendingApproval([first], first.id)).toEqual([])
  })

  it('reconciles stale local approvals against a reconnect snapshot', () => {
    const second = { ...first, id: 'approval-2', path: '/outside/b.txt' }

    expect(replacePendingApprovals([first, second, second])).toEqual([first, second])
    expect(replacePendingApprovals([])).toEqual([])
  })
})
