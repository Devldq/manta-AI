import { describe, expect, it, vi } from 'vitest'
import {
  getAvailableEmbeddingModels,
  inspectLocalOllamaEmbeddingModel,
  OPENAI_EMBEDDING_MODEL_CATALOG,
  resolveEffectiveEmbeddingSelection,
  type OllamaModel,
} from './embedding-service'

const installedModels: OllamaModel[] = [
  { name: 'qwen3:latest', size: 1, modifiedAt: '', digest: 'chat' },
  { name: 'qwen3-embedding:0.6b', size: 1, modifiedAt: '', digest: 'small' },
  { name: 'qwen3-embedding:8b', size: 1, modifiedAt: '', digest: 'large' },
]

describe('Ollama embedding model discovery', () => {
  it('keeps only embedding-capable models with their actual dimensions', async () => {
    const inspectModel = vi.fn(async (name: string) => {
      if (name === 'qwen3:latest') return null
      return {
        id: name,
        name: `${name} (本地)`,
        dimensions: name.endsWith('0.6b') ? 1024 : 4096,
      }
    })

    const models = await getAvailableEmbeddingModels({
      listModels: async () => installedModels,
      inspectModel,
    })

    expect(models.local).toEqual([
      { id: 'qwen3-embedding:0.6b', name: 'qwen3-embedding:0.6b (本地)', dimensions: 1024 },
      { id: 'qwen3-embedding:8b', name: 'qwen3-embedding:8b (本地)', dimensions: 4096 },
    ])
  })

  it('reads capability and dimensions from the Ollama show response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      capabilities: ['embedding'],
      model_info: { 'qwen3.embedding_length': 4096 },
    }), { status: 200 })) as typeof fetch

    await expect(inspectLocalOllamaEmbeddingModel('qwen3-embedding:8b', { fetchImpl })).resolves.toEqual({
      id: 'qwen3-embedding:8b',
      name: 'qwen3-embedding:8b (本地)',
      dimensions: 4096,
    })
  })

  it('uses the discovered local model when OpenAI has no API key', () => {
    const selection = resolveEffectiveEmbeddingSelection(
      { provider: 'openai', model: 'text-embedding-3-small' },
      {
        local: [{ id: 'qwen3-embedding:0.6b', name: 'local', dimensions: 1024 }],
        openai: [{ id: 'text-embedding-3-small', name: 'openai', dimensions: 1536 }],
      },
    )

    expect(selection).toEqual({ provider: 'local', model: 'qwen3-embedding:0.6b' })
  })
})

describe('OpenAI embedding model catalog', () => {
  it('identifies the legacy model instead of presenting it as a discovered current model', () => {
    expect(OPENAI_EMBEDDING_MODEL_CATALOG).toEqual([
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimensions: 1536 },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimensions: 3072 },
      {
        id: 'text-embedding-ada-002',
        name: 'text-embedding-ada-002（旧版）',
        dimensions: 1536,
        deprecated: true,
      },
    ])
  })
})
