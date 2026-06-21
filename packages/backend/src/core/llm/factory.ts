/**
 * @deprecated 项目已迁移到 AI SDK (ai)，不再使用 LangChain。此文件保留仅为历史参考，后续版本将删除。
 * 
 * LangChain 模型工厂 — 根据 LLMConfig 创建对应的 ChatModel
 */
import type { LLMConfig } from './types'
// @ts-ignore — LangChain 类型在新架构中已移除
type BaseChatModel = any

/**
 * 根据配置创建 LangChain ChatModel 实例
 * 支持 OpenAI / OpenAI 兼容 API / Ollama / LM Studio
 */
export async function createChatModel(config: LLMConfig): Promise<BaseChatModel> {
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.maxTokens

  switch (config.provider) {
    case 'openai': {
      // AI: 官方 OpenAI API
      // @ts-ignore — LangChain 模块已废弃
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature,
        maxTokens,
      })
    }

    case 'openai-compatible': {
      // AI: OpenAI 兼容 API（DeepSeek、通义千问、Moonshot 等）
      // @ts-ignore — LangChain 模块已废弃
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        apiKey: config.apiKey || 'placeholder',
        model: config.model,
        temperature,
        maxTokens,
        configuration: {
          baseURL: config.baseUrl,
        },
      })
    }

    case 'ollama': {
      // AI: 本地 Ollama 服务
      // @ts-ignore — LangChain 模块已废弃
      const { ChatOllama } = await import('@langchain/ollama')
      return new ChatOllama({
        baseUrl: config.baseUrl || 'http://localhost:11434',
        model: config.model,
        temperature,
      })
    }

    case 'lm-studio': {
      // AI: LM Studio 本地服务（兼容 OpenAI API）
      // @ts-ignore — LangChain 模块已废弃
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        apiKey: 'lm-studio',
        model: config.model || 'local-model',
        temperature,
        maxTokens,
        configuration: {
          baseURL: config.baseUrl || 'http://localhost:1234/v1',
        },
      })
    }

    default:
      throw new Error(`不支持的 LLM provider: ${config.provider}`)
  }
}

/** 快速测试 LLM 连通性（发送简短 ping 消息）*/
export async function testLLMConnection(config: LLMConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const model = await createChatModel(config)
    // @ts-ignore — LangChain 模块已废弃
    const { HumanMessage } = await import('@langchain/core/messages')
    const response = await model.invoke([new HumanMessage('Hi, reply with just "ok"')])
    // AI: 忽略返回内容，仅验证连通性
    void response.content
    return { ok: true, error: undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
