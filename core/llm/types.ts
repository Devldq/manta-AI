/* LLM 配置类型定义 */

export type LLMProvider = 'openai' | 'openai-compatible' | 'ollama' | 'lm-studio'

export interface LLMConfig {
  provider: LLMProvider
  /** OpenAI / 兼容 API 的密钥 */
  apiKey?: string
  /** 自定义 API endpoint（兼容模式 / Ollama / LM Studio）*/
  baseUrl?: string
  /** 模型名称 */
  model: string
  /** 温度（0~2，默认 0.7）*/
  temperature?: number
  /** 最大输出 token 数 */
  maxTokens?: number
}

/** 各 provider 的默认模型建议列表 */
export const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, string[]> = {
  'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  'openai-compatible': ['deepseek-chat', 'qwen-turbo', 'qwen-plus', 'glm-4', 'moonshot-v1-8k'],
  'ollama': ['llama3.2', 'llama3.1', 'qwen2.5', 'deepseek-r1', 'mistral', 'phi4'],
  'lm-studio': ['local-model'],
}

/** provider 的默认 base URL */
export const PROVIDER_DEFAULT_BASE_URLS: Partial<Record<LLMProvider, string>> = {
  'openai': 'https://api.openai.com/v1',
  'ollama': 'http://localhost:11434',
  'lm-studio': 'http://localhost:1234/v1',
}

/** 默认配置（使用环境变量兜底）*/
export function getDefaultLLMConfig(): LLMConfig {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY
  const baseUrl = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (baseUrl && baseUrl !== 'https://api.openai.com/v1') {
    return { provider: 'openai-compatible', apiKey, baseUrl, model, temperature: 0.7 }
  }

  return {
    provider: 'openai',
    apiKey,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    model,
    temperature: 0.7,
  }
}
