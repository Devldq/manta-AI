import type { EmbeddingService } from '../types'

// ─── OpenAI Embedding Service ────────────────────────────────

export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string
  private baseUrl: string
  private model: string
  private dimensions: number

  constructor(config?: { apiKey?: string; baseUrl?: string; model?: string; dimensions?: number }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || ''
    this.baseUrl = config?.baseUrl || 'https://api.openai.com/v1'
    this.model = config?.model || 'text-embedding-3-small'
    this.dimensions = config?.dimensions || 1536
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable')
    }

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
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable')
    }

    if (texts.length === 0) return []

    // OpenAI 支持批量输入
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

    // 按 index 排序确保顺序正确
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
    this.baseUrl = config?.baseUrl || 'http://localhost:11434'
    this.model = config?.model || 'nomic-embed-text'
    this.dimensions = config?.dimensions || 768
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
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
        `确保 Ollama 已启动并已拉取模型: ollama pull ${this.model}`
      )
    }

    const data = (await response.json()) as { embedding: number[] }
    return data.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama 不支持批量，逐个调用
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

// ─── 工厂函数 ────────────────────────────────────────────────

export function createEmbeddingService(
  provider: 'openai' | 'local' = 'openai',
  config?: Record<string, unknown>
): EmbeddingService {
  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingService(config as any)
    case 'local':
      return new LocalEmbeddingService(config as any)
    default:
      throw new Error(`Unknown embedding provider: ${provider}`)
  }
}
