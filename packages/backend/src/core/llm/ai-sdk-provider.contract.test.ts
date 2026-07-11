import { describe, expect, it } from 'vitest'
import { generateText, streamText } from 'ai'
import { createAISDKModel } from './ai-sdk-provider'

async function compileProviderCallBoundary(): Promise<void> {
  const model = await createAISDKModel()
  generateText({ model, prompt: 'contract check' })
  streamText({ model, prompt: 'contract check' })
}

describe('AI SDK provider contract', () => {
  it('exposes a model factory for AI SDK call boundaries', () => {
    expect(typeof createAISDKModel).toBe('function')
    expect(typeof compileProviderCallBoundary).toBe('function')
  })
})
