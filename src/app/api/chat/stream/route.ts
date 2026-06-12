/* POST /api/chat/stream — LangChain 流式聊天，返回 SSE */
import { NextRequest } from 'next/server'
import { getLLMConfig } from '@llm/config-store'
import { createChatModel } from '@llm/factory'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface ChatStreamRequest {
  message: string
  history?: ChatMessage[]
  systemPrompt?: string
}

export async function POST(req: NextRequest) {
  let body: ChatStreamRequest

  try {
    body = await req.json()
  } catch {
    return new Response('请求体解析失败', { status: 400 })
  }

  const { message, history = [], systemPrompt } = body

  if (!message?.trim()) {
    return new Response('message 不能为空', { status: 400 })
  }

  // AI: 读取 LLM 配置
  const llmConfig = getLLMConfig()
  if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
    return new Response(
      JSON.stringify({ error: 'LLM 未配置，请在设置中配置 API Key 或选择本地模型' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const encoder = new TextEncoder()

  /*  start: LangChain 流式 SSE 推送 */
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        // AI: 构建 LangChain 消息列表
        const { HumanMessage, AIMessage, SystemMessage } = await import('@langchain/core/messages')

        const messages = []

        if (systemPrompt) {
          messages.push(new SystemMessage(systemPrompt))
        }

        // AI: 追加历史消息
        for (const h of history) {
          if (h.role === 'user') messages.push(new HumanMessage(h.content))
          else if (h.role === 'assistant') messages.push(new AIMessage(h.content))
          else if (h.role === 'system') messages.push(new SystemMessage(h.content))
        }

        // AI: 追加当前用户消息
        messages.push(new HumanMessage(message))

        // AI: 创建模型并流式输出
        const model = await createChatModel(llmConfig)
        const streamIter = await model.stream(messages)

        let fullContent = ''

        for await (const chunk of streamIter) {
          const text = typeof chunk.content === 'string'
            ? chunk.content
            : Array.isArray(chunk.content)
              ? chunk.content.map((c) => (typeof c === 'string' ? c : '')).join('')
              : ''

          if (text) {
            fullContent += text
            send('chunk', { text })
          }
        }

        send('done', { content: fullContent })
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })
  /*  end: LangChain 流式 SSE 推送 */

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
