/* AI SDK provider 适配层 — 根据 LLMConfig 返回对应的 Vercel AI SDK model 实例
 *
 * MiMo thinking 模型适配：
 * MiMo 的推理模型输出结构包含非标准 reasoning_content 字段，
 * 并要求在多轮 tool call 对话中回传此字段。
 * @ai-sdk/openai 的标准 provider 不支持此字段，
 * 通过模块级共享存储 + 自定义 fetch 在 AI SDK 层面处理这个结构差异。
 */
import { getLLMConfig, getLLMProfiles } from './config-store'
import { profileToLLMConfig } from './types'
import type { LLMConfig } from './types'

// ─── MiMo reasoning_content 共享存储 ─────────────────────────────────────────────
//
// 自定义 fetch 在响应侧直接从 MiMo 原始 SSE 流中提取 reasoning_content 存入此队列。
// 请求侧按 assistant 消息顺序从队列中取出注入。
// FIFO 队列保证每个 assistant 消息拿到正确的 reasoning，不依赖 AI SDK 是否解析 reasoning_content。

/** reasoning 内容 FIFO 队列 */
const reasoningQueue: string[] = []

/** 取出队列头部 reasoning（由自定义 fetch 内部调用） */
function dequeueReasoning(): string | undefined {
  return reasoningQueue.shift()
}

/** 清除所有 reasoning 存储（新对话开始时调用） */
export function clearAllReasoning(): void {
  reasoningQueue.length = 0
}

// ─── MiMo 检测 ────────────────────────────────────────────────────────────────────

/** 检测当前 provider 是否需要 reasoning_content 回传适配 */
function needsReasoningPassthrough(cfg: LLMConfig): boolean {
  if (cfg.provider === 'openai-compatible' && cfg.baseUrl) {
    const url = cfg.baseUrl.toLowerCase()
    // 精确匹配 MiMo API 端点（避免误判）
    if (url.includes('xiaomimimo.com')) {
      const model = cfg.model.toLowerCase()
      if (model.startsWith('mimo-v2.5') || model.startsWith('mimo-v2-pro') || model.startsWith('mimo-v2-omni')) {
        return true
      }
    }
  }
  return false
}

// ─── 自定义 fetch：注入 reasoning_content ─────────────────────────────────────────

/**
 * 在 AI SDK 层面处理 MiMo 输出结构差异的自定义 fetch 函数
 *
 * 双向拦截：
 * 【请求侧】扫描 assistant 消息，从 FIFO 队列中取出 reasoning 注入 reasoning_content
 * 【响应侧】从 MiMo 的原始 SSE 流中直接提取 reasoning_content 存入队列
 *          （不依赖 AI SDK 是否解析 reasoning_content）
 */
function createReasoningPassthroughFetch(originalFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    // ─── 请求侧：注入 reasoning_content ──────────────────────────────────────
    let modifiedInit = init
    if (init?.method === 'POST' && init?.body) {
      try {
        const body = JSON.parse(init.body as string)
        if (body.messages && Array.isArray(body.messages)) {
          for (const msg of body.messages) {
            if (msg.role === 'assistant') {
              if (msg.reasoning_content) continue
              const reasoning = dequeueReasoning()
              if (reasoning) msg.reasoning_content = reasoning
            }
          }
        }
        modifiedInit = { ...init, body: JSON.stringify(body) }
      } catch { /* ignore */ }
    }

    const response = await originalFetch(input, modifiedInit)

    // ─── 响应侧：从原始 SSE 流中提取 reasoning_content ─────────────────────────
    if (response.ok && response.body) {
      const contentType = response.headers.get('content-type') || ''
      const isStreaming = contentType.includes('text/event-stream')

      // 收集本响应的 reasoning（用于下次请求注入）
      let collected = ''
      const textDecoder = new TextDecoder()

      if (isStreaming) {
        // 流式响应：创建 TransformStream，透传数据的同时提取 reasoning_content
        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk) // 透传给下游（AI SDK）
            // 解析 SSE 事件，提取 reasoning_content
            const text = textDecoder.decode(chunk, { stream: true })
            const lines = text.split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const parsed = JSON.parse(line.slice(6))
                  const delta = parsed?.choices?.[0]?.delta
                  if (delta?.reasoning_content) {
                    collected += delta.reasoning_content
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          },
          flush() {
            // 流结束时，将收集的 reasoning 存入 FIFO 队列
            if (collected) reasoningQueue.push(collected)
          },
        })

        return new Response(response.body.pipeThrough(transformStream), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      } else {
        // 非流式响应：从 body 直接提取
        try {
          const json = await response.json()
          const reasoning = json?.choices?.[0]?.message?.reasoning_content
          if (reasoning) reasoningQueue.push(reasoning)
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        } catch {
          return response
        }
      }
    }

    return response
  }
}

// ─── Provider 创建 ──────────────────────────────────────────────────────────────

/** 根据配置创建 AI SDK LanguageModel 实例 */
export async function createAISDKModel(config?: LLMConfig) {
  const cfg = config ?? getLLMConfig()
  const { createOpenAI } = await import('@ai-sdk/openai')

  const needsPassthrough = needsReasoningPassthrough(cfg)
  const customFetch = needsPassthrough
    ? createReasoningPassthroughFetch(globalThis.fetch)
    : undefined

  switch (cfg.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: cfg.apiKey || '',
        baseURL: cfg.baseUrl || 'https://api.openai.com/v1',
      })
      return openai.chat(cfg.model)
    }

    case 'openai-compatible': {
      const openai = createOpenAI({
        apiKey: cfg.apiKey || 'placeholder',
        baseURL: cfg.baseUrl || 'https://api.openai.com/v1',
        fetch: customFetch,
      })
      return openai.chat(cfg.model)
    }

    case 'ollama': {
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

/** 快速获取当前配置的 AI SDK model */
export async function getAISDKModel() {
  return createAISDKModel()
}

/** 按 profileId 获取指定模型实例 */
export async function getAISDKModelByProfileId(profileId: string) {
  const profilesConfig = getLLMProfiles()
  const found = profilesConfig.profiles.find((p) => p.id === profileId)
  if (!found) {
    throw new Error(`找不到配置 profile: ${profileId}`)
  }
  return createAISDKModel(profileToLLMConfig(found))
}

/** 判断当前模型是否需要 reasoning_content 回传 */
export function isReasoningPassthroughNeeded(config?: LLMConfig): boolean {
  return needsReasoningPassthrough(config ?? getLLMConfig())
}