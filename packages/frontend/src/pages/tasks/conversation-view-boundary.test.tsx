import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { ConversationViewBoundary } from './page'

describe('ConversationViewBoundary', () => {
  it('keys conversation-local state by the active task id', () => {
    const child = createElement('div')
    const first = ConversationViewBoundary({ conversationId: 'conversation-a', children: child })
    const second = ConversationViewBoundary({ conversationId: 'conversation-b', children: child })

    expect(first.key).toBe('conversation-a')
    expect(second.key).toBe('conversation-b')
  })
})
