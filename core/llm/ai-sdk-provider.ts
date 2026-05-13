/* AI SDK provider 适配层 — 根据 LLMConfig 返回对应的 Vercel AI SDK model 实例 */
import { getLLMConfig } from './config-store'
import type { LLMConfig } from './types'

/**
 * 根据配置创建 AI SDK LanguageModel 实例
 * 统一使用 @ai-sdk/openai 的 createOpenAI（支持 baseURL 兼容 Ollama / LM Studio / 各类兼容 API）
 */
export async function createAISDKModel(config?: LLMConfig) {
  const cfg = config ?? getLLMConfig()
  const { createOpenAI } = await import('@ai-sdk/openai')

  switch (cfg.provider) {
    case 'openai': {
      // OpenAI 官方：可以用 Responses API（默认）也可以用 chat()
      // 为保证兼容性统一用 .chat()
      const openai = createOpenAI({
        apiKey: cfg.apiKey || '',
        baseURL: cfg.baseUrl || 'https://api.openai.com/v1',
      })
      return openai.chat(cfg.model)
    }

    case 'openai-compatible': {
      // 兼容 API（DeepSeek / 通义千问 / Moonshot 等）只支持 Chat Completions，必须用 .chat()
      const openai = createOpenAI({
        apiKey: cfg.apiKey || 'placeholder',
        baseURL: cfg.baseUrl || 'https://api.openai.com/v1',
      })
      return openai.chat(cfg.model)
    }

    case 'ollama': {
      // Ollama：OpenAI 兼容接口，需要加 /v1 路径，用 .chat()
      const baseURL = cfg.baseUrl
        ? `${cfg.baseUrl.replace(/\/$/, '')}/v1`
        : 'http://localhost:11434/v1'
      const openai = createOpenAI({
        apiKey: 'ollama',
        baseURL,
      })
      return openai.chat(cfg.model)
    }

    case 'lm-studio': {
      // LM Studio：OpenAI 兼容接口，用 .chat()
      const openai = createOpenAI({
        apiKey: 'lm-studio',
        baseURL: cfg.baseUrl || 'http://localhost:1234/v1',
      })
      return openai.chat(cfg.model)
    }

    default:
      throw new Error(`不支持的 LLM provider: ${cfg.provider}`)
  }
}

/** 快速获取当前配置的 AI SDK model（最常用） */
export async function getAISDKModel() {
  return createAISDKModel()
}
