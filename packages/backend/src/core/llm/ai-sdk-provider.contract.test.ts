import { describe, expect, it } from 'vitest'
import { createAISDKModel } from './ai-sdk-provider'

describe('AI SDK provider contract', () => {
  it('constructs an OpenAI-compatible V3 model without making a request', async () => {
    const model = await createAISDKModel({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'test-chat-model',
    })

    expect(model.specificationVersion).toBe('v3')
    expect(model.provider).toBe('openai.chat')
    expect(model.modelId).toBe('test-chat-model')
  })

  it('constructs an Anthropic V3 model without making a request', async () => {
    const model = await createAISDKModel({
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'test-claude-model',
    })

    expect(model.specificationVersion).toBe('v3')
    expect(model.provider).toBe('anthropic.messages')
    expect(model.modelId).toBe('test-claude-model')
  })
})
