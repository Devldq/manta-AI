import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentRunContextSnapshot } from './agent-run-context.js'
import {
  clearAllCachedConversationContexts,
  getCachedConversationContext,
  setCachedConversationContext,
} from './conversation-context-cache.js'

describe('conversation context cache', () => {
  beforeEach(() => clearAllCachedConversationContexts())

  it('reuses five fixed layers for the same conversation epoch', () => {
    const runContext = createAgentRunContextSnapshot('system', { read: {} })
    setCachedConversationContext('conversation-1', {
      fingerprint: 'epoch-a',
      runContext,
      pipeStats: [],
      soulLength: 0,
    })

    expect(getCachedConversationContext('conversation-1', 'epoch-a')?.runContext).toBe(runContext)
    expect(getCachedConversationContext('conversation-1', 'epoch-b')).toBeNull()
  })
})
