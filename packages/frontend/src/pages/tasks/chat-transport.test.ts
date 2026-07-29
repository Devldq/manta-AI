import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prepareIncrementalChatRequest } from './chat-transport'

describe('prepareIncrementalChatRequest', () => {
  it('sends only the newest user message instead of historical tool results', async () => {
    const hugeToolOutput = 'x'.repeat(1_100_000)
    const messages = [
      {
        id: 'user-old',
        role: 'user',
        parts: [{ type: 'text', text: '旧问题' }],
      },
      {
        id: 'assistant-old',
        role: 'assistant',
        parts: [{
          type: 'dynamic-tool',
          toolCallId: 'tool-1',
          toolName: 'read',
          state: 'output-available',
          input: { path: '/tmp/large.txt' },
          output: hugeToolOutput,
        }],
      },
      {
        id: 'user-new',
        role: 'user',
        parts: [{ type: 'text', text: '继续' }],
      },
    ] as unknown as UIMessage[]

    const request = await prepareIncrementalChatRequest({
      id: 'conversation-1',
      messages,
      requestMetadata: undefined,
      body: { agentName: 'main' },
      credentials: undefined,
      headers: undefined,
      api: '/api/conversations/conversation-1/ai-stream',
      trigger: 'submit-message',
      messageId: 'user-new',
    })

    expect(request.body).toEqual({
      agentName: 'main',
      message: messages[2],
    })
    expect(JSON.stringify(request.body).length).toBeLessThan(1_000)
  })
})
