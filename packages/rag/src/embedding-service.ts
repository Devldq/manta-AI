import type { EmbeddingService } from './types'

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
    // Node.js fetch 不支持 IPv6→IPv4 自动回退，必须显式用 127.0.0.1
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
          // 指数退避: 1s, 2s, 4s
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
    // Ollama 不支持批量，逐个调用（带重试）
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

// ─── Ollama 本地模型查询 ──────────────────────────────────────

/** 本地 Ollama 模型信息 */
export interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
  digest: string
}

import { exec as execCallback } from 'node:child_process'

/**
 * 执行 ollama list 命令获取本地模型
 */
export async function listLocalOllamaModels(): Promise<OllamaModel[]> {
  return new Promise((resolve) => {
    execCallback('ollama list', { timeout: 5000 }, (error: Error | null, stdout: string) => {
      if (error || !stdout) {
        resolve([])
        return
      }

      const models: OllamaModel[] = []
      const lines = stdout.trim().split('\n')

      // 跳过表头；按固定列宽解析 ollama list 输出
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

/** 解析 ollama list 的 size 格式 (如 137M, 2.1G) */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)([KMGT]?)/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return Math.round(value * (multipliers[unit] || 1))
}

/**
 * 获取可用的 embedding 模型
 * 优先返回本地安装的 embedding 模型
 */
export async function getAvailableEmbeddingModels(): Promise<{
  local: { id: string; name: string; dimensions: number }[]
  openai: { id: string; name: string; dimensions: number }[]
}> {
  const localModels = await listLocalOllamaModels()

  // 常见的 embedding 模型维度映射（名称去掉 tag 后匹配）
  const embeddingDimensions: Record<string, number> = {
    'nomic-embed-text': 768,
    'mxbai-embed-large': 1024,
    'bge-m3': 1024,
    'bge-large-zh-v1.5': 1024,
    'bge-small-zh-v1.5': 512,
    'embed-msmarco': 768,
    'e5-mistral-7b': 1024,
    'gte-Qwen2-7B': 768,
    'm2-bert-80m': 768,
    'Cohere-embed-v4': 1024,
    'qwen3-embedding:0.6b': 1024,
    'qwen3-embedding:4b': 1024,
    'qwen3-embedding:8b': 4096,
    'qwen3-embedding': 1024,
  }

  const local = localModels
    .filter((m) => m.name.includes('embed') || embeddingDimensions[m.name])
    .map((m) => ({
      id: m.name,
      name: `${m.name} (本地)`,
      dimensions: embeddingDimensions[m.name] || 768,
    }))

  const openai = [
    { id: 'text-embedding-3-small', name: 'text-embedding-3-small (1536维)', dimensions: 1536 },
    { id: 'text-embedding-3-large', name: 'text-embedding-3-large (3072维)', dimensions: 3072 },
    { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002 (1536维)', dimensions: 1536 },
  ]

  return { local, openai }
}

// ─── 工厂函数 ───────────────────────────────────────────────

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
