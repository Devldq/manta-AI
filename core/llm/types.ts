/* LLM 配置类型定义 */

export type LLMProvider = 'openai' | 'openai-compatible' | 'ollama' | 'lm-studio'

/** 单次 LLM 调用配置（下游使用方接口，保持不变） */
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
  /** 单次调用最大输出 token 数（传给模型） */
  maxTokens?: number
  /** Agent Loop 累计输出 token 预算上限，0 = 不限（默认 100 万） */
  maxOutputTokens?: number
  /** Agent Loop 最大步数上限，0 = 不限（默认 200） */
  maxSteps?: number
}

/** 单个模型配置 Profile — 带有 id、name、isDefault 等元信息 */
export interface ModelProfile {
  /** 配置的唯一标识（uuid） */
  id: string
  /** 用户给这个配置取的名字，如 "GPT-4o 日常对话"、"DeepSeek 代码助手" */
  name: string
  /** 是否为默认配置（同一时刻只允许一个 default） */
  isDefault?: boolean
  provider: LLMProvider
  apiKey?: string
  baseUrl?: string
  model: string
  temperature?: number
  /** 单次调用最大输出 token 数（传给模型） */
  maxTokens?: number
  /** Agent Loop 累计输出 token 预算上限，0 = 不限（默认 100 万） */
  maxOutputTokens?: number
  /** Agent Loop 最大步数上限，0 = 不限（默认 200） */
  maxSteps?: number
}

/** 多模型配置列表（新存储格式） */
export interface LLMProfilesConfig {
  /** 所有模型配置列表 */
  profiles: ModelProfile[]
  /** 当前激活使用的配置 id（若未指定则使用 isDefault 的配置） */
  activeProfileId?: string
}

/** 将 ModelProfile 转换为 LLMConfig（去除 profile 特有字段） */
export function profileToLLMConfig(profile: ModelProfile): LLMConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    maxOutputTokens: profile.maxOutputTokens,
    maxSteps: profile.maxSteps,
  }
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

/** Provider 配置元数据（UI 展示用） */
export const PROVIDER_META: { value: LLMProvider; label: string; desc: string }[] = [
  { value: 'openai', label: 'OpenAI', desc: 'api.openai.com — GPT-4o、GPT-3.5 等' },
  { value: 'openai-compatible', label: 'OpenAI 兼容 API', desc: 'DeepSeek、通义千问、Moonshot 等' },
  { value: 'ollama', label: 'Ollama（本地）', desc: 'localhost:11434 — 本地运行的 Ollama 服务' },
  { value: 'lm-studio', label: 'LM Studio（本地）', desc: 'localhost:1234 — LM Studio 本地服务' },
]

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