import { describe, expect, it } from 'vitest'
import { parseConversationHistoryToCore } from './message-parser'

describe('parseConversationHistoryToCore', () => {
  it('rebuilds context from persisted text without replaying tool payloads from the client', () => {
    const result = parseConversationHistoryToCore([
      { id: 'user-1', role: 'user', content: '第一问' },
      { id: 'assistant-1', role: 'assistant', content: '第一答' },
    ], {
      id: 'user-2',
      content: '继续',
    })

    expect(result).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '继续' },
    ])
  })

  it('does not duplicate a user message already committed by a durable job', () => {
    const result = parseConversationHistoryToCore([
      { id: 'user-1', role: 'user', content: '第一问' },
      { id: 'user-2', role: 'user', content: '继续' },
    ], {
      id: 'user-2',
      content: '继续',
    })

    expect(result.filter((message) => message.content === '继续')).toHaveLength(1)
  })
})
