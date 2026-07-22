import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { withPendingAssistantMessage } from './pending-assistant'

const assistant = (id: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text: 'answer' }] })
const user = (id: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: 'question' }] })

describe('pending assistant message', () => {
  it('creates a new assistant row below the newly submitted user message', () => {
    const result = withPendingAssistantMessage([assistant('old-answer'), user('new-question')], true, 'conv-1')

    expect(result.map((message) => [message.id, message.role])).toEqual([
      ['old-answer', 'assistant'],
      ['new-question', 'user'],
      ['pending-assistant-conv-1', 'assistant'],
    ])
    expect(result[result.length - 1]?.parts).toEqual([])
  })

  it('does not add a placeholder after the real streamed assistant arrives', () => {
    const messages = [user('new-question'), assistant('new-answer')]

    expect(withPendingAssistantMessage(messages, true, 'conv-1')).toBe(messages)
  })

  it('does not add a placeholder when generation is idle', () => {
    const messages = [user('new-question')]

    expect(withPendingAssistantMessage(messages, false, 'conv-1')).toBe(messages)
  })
})
