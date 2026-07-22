import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runWithStorageResolver } from '../../storage/path-routing'
import { getActiveProfile, getLLMProfiles, getLLMProfilesMasked, saveLLMProfiles, setActiveProfile } from './config-store'

function withStorage<T>(operation: () => T): T {
  const root = mkdtempSync(join(tmpdir(), 'manta-model-types-'))
  return runWithStorageResolver({ resolve: (group, ...segments) => join(root, group, ...segments) }, operation)
}

describe('LLM profile usage boundaries', () => {
  it('migrates legacy profiles and repairs an invalid Agent selection', () => withStorage(() => {
    saveLLMProfiles({
      activeProfileId: 'embedding',
      profiles: [
        { id: 'embedding', name: 'Embedding', provider: 'ollama', model: 'qwen3-embedding:0.6b', isDefault: true },
        { id: 'chat', name: 'Chat', provider: 'openai', model: 'gpt-4o-mini' },
        { id: 'reasoning', name: 'Reasoning', provider: 'openai-compatible', model: 'deepseek-reasoner' },
        { id: 'vision', name: 'Vision', provider: 'openai-compatible', model: 'glm-4.6v' },
      ],
    })

    const config = getLLMProfiles()
    expect(config.profiles.map((profile) => [profile.id, profile.modelType])).toEqual([
      ['embedding', 'embedding'],
      ['chat', 'chat'],
      ['reasoning', 'reasoning'],
      ['vision', 'multimodal'],
    ])
    expect(config.activeProfileId).toBe('chat')
    expect(getActiveProfile().id).toBe('chat')
    expect(config.profiles.find((profile) => profile.isDefault)?.id).toBe('chat')
  }))

  it('rejects non-Agent models as the active model', () => withStorage(() => {
    saveLLMProfiles({ profiles: [
      { id: 'chat', name: 'Chat', provider: 'openai', model: 'gpt-4o-mini' },
      { id: 'embedding', name: 'Embedding', provider: 'ollama', model: 'qwen3-embedding:0.6b' },
    ] })
    expect(() => setActiveProfile('embedding')).toThrow(/不能用于 Agent 对话/)
  }))

  it('never returns API keys in either masked profile list', () => withStorage(() => {
    saveLLMProfiles({ profiles: [
      { id: 'chat', name: 'Chat', provider: 'openai', model: 'gpt-4o-mini', apiKey: 'secret-api-key' },
    ] })
    const masked = getLLMProfilesMasked()
    expect(masked.profiles[0].apiKey).toBeUndefined()
    expect(masked.profilesMasked[0].apiKey).toBeUndefined()
    expect(masked.profilesMasked[0].apiKeyMasked).toMatch(/\*\*\*\*/)
  }))
})
