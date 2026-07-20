import type { EmbeddingService } from '@manta/rag'

// ─── OpenAI Embedding Service ────────────────────────────────

export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string
  private baseUrl: string
  private model: string
  private dimensions: number

  constructor(config: { apiKey: string; baseUrl: string; model: string; dimensions?: number }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl
    this.model = config.model
    this.dimensions = config.dimensions || 1536
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`OpenAI Embedding API error (${response.status}): ${errorBody}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }

    return data.data[0].embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`OpenAI Embedding API error (${response.status}): ${errorBody}`)
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>
    }

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding)
  }

  getDimensions(): number {
    return this.dimensions
  }
}

// ─── 本地 Ollama Embedding Service ───────────────────────────

export class LocalEmbeddingService implements EmbeddingService {
  private baseUrl: string
  private model: string
  private dimensions: number

  constructor(config?: { baseUrl?: string; model?: string; dimensions?: number }) {
    const rawUrl = config?.baseUrl || 'http://127.0.0.1:11434'
    this.baseUrl = rawUrl.replace('localhost', '127.0.0.1')
    this.model = config?.model || 'nomic-embed-text'
    this.dimensions = config?.dimensions || 768
  }

  async embed(text: string, retries = 3): Promise<number[]> {
    const url = `${this.baseUrl}/api/embeddings`
    let lastError: unknown

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: text,
          }),
        })

        if (!response.ok) {
          const errorBody = await response.text()
          throw new Error(
            `Ollama Embedding API error (${response.status}): ${errorBody}\n` +
            `模型: ${this.model}，URL: ${url}\n` +
            `确保 Ollama 已启动并已拉取模型: ollama pull ${this.model}`
          )
        }

        const data = (await response.json()) as { embedding: number[] }
        return data.embedding
      } catch (err) {
        lastError = err
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000
          console.warn(`[Embedding] fetch 失败，${delay}ms 后重试 (${attempt + 1}/${retries}): ${this.model} -> ${url}`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    throw new Error(
      `Ollama 连接失败（已重试 ${retries} 次）:\n` +
      `模型: ${this.model}，URL: ${url}\n` +
      `请确认: 1) ollama serve 正在运行  2) 执行 ollama pull ${this.model}\n` +
      `原始错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      results.push(await this.embed(text))
    }
    return results
  }

  getDimensions(): number {
    return this.dimensions
  }
}

// ─── Ollama 本地模型查询（动态读取 ollama list） ────────────

export interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
  digest: string
}

export interface AvailableEmbeddingModel {
  id: string
  name: string
  dimensions: number
  deprecated?: boolean
}

/** OpenAI 模型来自官方目录，不是运行时扫描结果。 */
export const OPENAI_EMBEDDING_MODEL_CATALOG: AvailableEmbeddingModel[] = [
  { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimensions: 1536 },
  { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimensions: 3072 },
  {
    id: 'text-embedding-ada-002',
    name: 'text-embedding-ada-002（旧版）',
    dimensions: 1536,
    deprecated: true,
  },
]

import { exec as execCallback } from 'node:child_process'

/** 执行 ollama list 获取本地已安装模型 */
export async function listLocalOllamaModels(): Promise<OllamaModel[]> {
  return new Promise((resolve) => {
    execCallback('ollama list', { timeout: 5000 }, (error: Error | null, stdout: string) => {
      if (error || !stdout) {
        resolve([])
        return
      }

      const models: OllamaModel[] = []
      const lines = stdout.trim().split('\n')

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trimEnd()
        if (!line.trim()) continue

        const name = line.slice(0, 24).trim()
        const id = line.slice(24, 40).trim()
        const sizeText = line.slice(40, 50).trim()
        const modifiedAt = line.slice(50).trim()

        if (!name || !id) continue

        models.push({
          name,
          size: parseSize(sizeText),
          digest: id,
          modifiedAt,
        })
      }

      resolve(models)
    })
  })
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)([KMGT]?)/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return Math.round(value * (multipliers[unit] || 1))
}

/** 读取 Ollama 模型能力，只返回可用于 embedding 的模型信息。 */
export async function inspectLocalOllamaEmbeddingModel(
  model: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<AvailableEmbeddingModel | null> {
  const baseUrl = (options.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const fetchImpl = options.fetchImpl || fetch

  try {
    const response = await fetchImpl(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return null

    const data = await response.json() as {
      capabilities?: string[]
      model_info?: Record<string, unknown>
    }
    if (!data.capabilities?.includes('embedding')) return null

    const dimensions = Object.entries(data.model_info || {})
      .find(([key, value]) => key.endsWith('.embedding_length') && typeof value === 'number')?.[1]
    if (typeof dimensions !== 'number' || !Number.isSafeInteger(dimensions) || dimensions <= 0) return null

    return { id: model, name: `${model} (本地)`, dimensions }
  } catch {
    return null
  }
}

/**
 * 获取可用的 embedding 模型列表。
 * 本地模型需同时存在于 ollama list 且声明 embedding capability。
 */
export async function getAvailableEmbeddingModels(options: {
  listModels?: typeof listLocalOllamaModels
  inspectModel?: typeof inspectLocalOllamaEmbeddingModel
} = {}): Promise<{
  local: AvailableEmbeddingModel[]
  openai: AvailableEmbeddingModel[]
}> {
  const localModels = await (options.listModels || listLocalOllamaModels)()
  const inspectModel = options.inspectModel || inspectLocalOllamaEmbeddingModel
  const inspected = await Promise.all(localModels.map((model) => inspectModel(model.name)))
  const local = inspected.filter((model): model is AvailableEmbeddingModel => model !== null)

  const openai = OPENAI_EMBEDDING_MODEL_CATALOG

  return { local, openai }
}

export function resolveEffectiveEmbeddingSelection(
  config: { provider: 'openai' | 'local'; model: string; apiKey?: string },
  models: { local: AvailableEmbeddingModel[]; openai: AvailableEmbeddingModel[] },
): { provider: 'openai' | 'local'; model: string } {
  if (config.provider === 'openai' && !config.apiKey && models.local.length > 0) {
    return { provider: 'local', model: models.local[0].id }
  }

  const configuredModels = models[config.provider]
  if (configuredModels.some((model) => model.id === config.model)) {
    return { provider: config.provider, model: config.model }
  }
  if (configuredModels.length > 0) {
    return { provider: config.provider, model: configuredModels[0].id }
  }

  const fallbackProvider = config.provider === 'local' ? 'openai' : 'local'
  return {
    provider: fallbackProvider,
    model: models[fallbackProvider][0]?.id || config.model,
  }
}

// ─── 工厂函数 ───────────────────────────────────────────────

export function createEmbeddingService(
  provider: 'openai' | 'local' = 'openai',
  config?: Record<string, unknown>
): EmbeddingService {
  switch (provider) {
    case 'openai': {
      const cfg = config || {}
      const apiKey = cfg.apiKey as string | undefined
      const baseUrl = cfg.baseUrl as string | undefined
      const model = cfg.model as string | undefined
      if (!apiKey) throw new Error('OpenAI embedding requires `apiKey` in config.')
      if (!baseUrl) throw new Error('OpenAI embedding requires `baseUrl` in config.')
      if (!model) throw new Error('OpenAI embedding requires `model` in config.')
      return new OpenAIEmbeddingService({ apiKey, baseUrl, model, dimensions: cfg.dimensions as number | undefined })
    }
    case 'local':
      return new LocalEmbeddingService(config as any)
    default:
      throw new Error(`Unknown embedding provider: ${provider}`)
  }
}
