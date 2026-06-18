import type { EmbeddingService } from '../types'

/**
 * OpenAI Embedding 服务实现
 * 使用 OpenAI API 生成文本嵌入
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string
  private model: string
  private dimensions: number

  constructor(config?: { apiKey?: string; model?: string; dimensions?: number }) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || ''
    this.model = config?.model || 'text-embedding-3-small'
    this.dimensions = config?.dimensions || 1536
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // 实际实现：
    // 1. 调用 OpenAI Embeddings API
    // 2. 返回嵌入向量

    // 占位实现：返回随机向量
    console.log(`生成嵌入: "${text.substring(0, 50)}..."`)
    return Array.from({ length: this.dimensions }, () => Math.random())
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // 实际实现：
    // 1. 批量调用 OpenAI Embeddings API
    // 2. 返回嵌入向量数组

    // 占位实现：返回随机向量数组
    console.log(`批量生成嵌入: ${texts.length} 个文本`)
    return texts.map(() =>
      Array.from({ length: this.dimensions }, () => Math.random())
    )
  }

  getDimensions(): number {
    return this.dimensions
  }
}

/**
 * 本地 Embedding 服务实现（使用 Ollama）
 */
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
    // 实际实现：
    // 1. 调用 Ollama API
    // 2. 返回嵌入向量

    // 占位实现：返回随机向量
    console.log(`本地生成嵌入: "${text.substring(0, 50)}..."`)
    return Array.from({ length: this.dimensions }, () => Math.random())
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 实际实现：
    // 1. 批量调用 Ollama API
    // 2. 返回嵌入向量数组

    // 占位实现：返回随机向量数组
    console.log(`本地批量生成嵌入: ${texts.length} 个文本`)
    return texts.map(() =>
      Array.from({ length: this.dimensions }, () => Math.random())
    )
  }

  getDimensions(): number {
    return this.dimensions
  }
}

/**
 * 创建 Embedding 服务实例
 */
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