import { describe, expect, it } from 'vitest'
import { claimConversationFallback } from './ConversationList'

describe('ConversationList fallback loading', () => {
  it('claims at most one fallback fetch per mount after a successful empty response', () => {
    const requested = { current: false }

    expect(claimConversationFallback(0, false, requested)).toBe(true)
    expect(claimConversationFallback(0, true, requested)).toBe(false)
    expect(claimConversationFallback(0, false, requested)).toBe(false)
    expect(requested.current).toBe(true)
  })
})
