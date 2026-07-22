import { describe, expect, it } from 'vitest'
import {
  inferModelType,
  isAgentModel,
  isEmbeddingModel,
  isMultimodalModel,
  resolveModelType,
  type ModelProfile,
} from './types'

function profile(model: string, modelType?: ModelProfile['modelType']): ModelProfile {
  return { id: model, name: model, provider: 'openai-compatible', model, modelType }
}

describe('model profile types', () => {
  it('infers safe types for legacy model profiles', () => {
    expect(inferModelType('qwen3-embedding:0.6b')).toBe('embedding')
    expect(inferModelType('glm-4.6v')).toBe('multimodal')
    expect(inferModelType('glm-4.1v-thinking-flashx')).toBe('multimodal')
    expect(inferModelType('deepseek-reasoner')).toBe('reasoning')
    expect(inferModelType('gpt-4o-mini')).toBe('chat')
  })

  it('prefers an explicit type over legacy inference', () => {
    expect(resolveModelType(profile('custom-model', 'embedding'))).toBe('embedding')
    expect(resolveModelType(profile('model-with-embedding-in-name', 'chat'))).toBe('chat')
  })

  it('enforces usage boundaries', () => {
    expect(isAgentModel(profile('chat', 'chat'))).toBe(true)
    expect(isAgentModel(profile('reasoning', 'reasoning'))).toBe(true)
    expect(isAgentModel(profile('embedding', 'embedding'))).toBe(false)
    expect(isEmbeddingModel(profile('embedding', 'embedding'))).toBe(true)
    expect(isMultimodalModel(profile('vision', 'multimodal'))).toBe(true)
  })
})
