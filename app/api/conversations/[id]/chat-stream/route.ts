/* POST /api/conversations/[id]/chat-stream — LangChain 直接聊天流式输出（chat 模式）
   不创建 Task，直接调用 LLM API，支持完整对话历史和 Agent 角色切换 */
import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  getConversation,
  appendMessage,
  updateLastAssistantMessage,
} from '@/core/conversation/store'
import { getLLMConfig } from '@/core/llm/config-store'
import { createChatModel } from '@/core/llm/factory'

interface RouteContext {
  params: Promise<{ id: string }>
}

// AI: 读取指定 agent 的 SOUL.md 作为 system prompt
function readAgentSoul(agentName: string): string | null {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) return null
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; name?: string; workspace?: string }> = config?.agents?.list ?? []
    const entry = list.find((a) => (a.id === agentName || a.name === agentName))
    if (!entry) return null

    let workspace = entry.workspace
    if (!workspace) {
      workspace = path.join(os.homedir(), '.openclaw', `workspace-${agentName}`)
    } else if (workspace.startsWith('~/')) {
      workspace = path.join(os.homedir(), workspace.slice(2))
    }

    const soulPath = path.join(workspace, 'SOUL.md')
    if (!fs.existsSync(soulPath)) return null
    return fs.readFileSync(soulPath, 'utf-8').trim() || null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // AI: 读取会话
  const conv = getConversation(id)
  if (!conv) {
    return new Response('会话不存在', { status: 404 })
  }

  let body: { message: string; agentName?: string; systemPrompt?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('请求体解析失败', { status: 400 })
  }

  const { message, agentName, systemPrompt: customSystemPrompt } = body
  if (!message?.trim()) {
    return new Response('message 不能为空', { status: 400 })
  }

  // AI: 读取 LLM 配置
  const llmConfig = getLLMConfig()

  // AI: 读取 agent 的 SOUL.md 作为系统提示（优先级：自定义 > SOUL.md > 无）
  const effectiveAgentName = agentName || conv.agentName
  const soulPrompt = readAgentSoul(effectiveAgentName)
  const systemPrompt = customSystemPrompt || soulPrompt || null

  // AI: 追加用户消息到会话存储（记录历史对话）
  const userResult = appendMessage(id, 'user', message.trim())
  if (!userResult) {
    return new Response('追加消息失败', { status: 500 })
  }

  // AI: 追加占位 assistant 消息
  const assistantResult = appendMessage(id, 'assistant', '')
  const assistantMsgId = assistantResult?.message.id ?? null

  const encoder = new TextEncoder()

  /*  start: LangChain 流式 SSE — chat 模式，支持 agent 角色 */
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        // AI: 校验 LLM 配置
        if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
          send('error', { message: 'LLM 未配置 API Key，请前往 Settings → AI 模型 进行配置' })
          return
        }

        const { HumanMessage, AIMessage, SystemMessage } = await import('@langchain/core/messages')

        const langchainMessages = []

        // AI: 系统提示词（agent SOUL.md 内容）
        if (systemPrompt) {
          langchainMessages.push(new SystemMessage(systemPrompt))
        }

        // AI: 构建历史消息（取最近 20 条，仅含有内容的消息）
        const historyMsgs = conv.messages
          .filter((m) => m.content.trim())
          .slice(-20)

        for (const m of historyMsgs) {
          if (m.role === 'user') langchainMessages.push(new HumanMessage(m.content))
          else langchainMessages.push(new AIMessage(m.content))
        }

        // AI: 追加本次用户消息
        langchainMessages.push(new HumanMessage(message.trim()))

        const model = await createChatModel(llmConfig)
        const streamIter = await model.stream(langchainMessages)

        let fullContent = ''

        send('start', {
          conversationId: id,
          agentName: effectiveAgentName,
          hasSoul: !!soulPrompt,
          userMessageId: userResult.message.id,
          assistantMessageId: assistantMsgId,
        })

        for await (const chunk of streamIter) {
          const text = typeof chunk.content === 'string'
            ? chunk.content
            : Array.isArray(chunk.content)
              ? chunk.content
                  .map((c) => (typeof c === 'string' ? c : (c as { text?: string }).text ?? ''))
                  .join('')
              : ''

          if (text) {
            fullContent += text
            send('chunk', { text })
          }
        }

        // AI: 持久化 assistant 消息内容
        if (fullContent) {
          updateLastAssistantMessage(id, fullContent)
        }

        send('done', {
          content: fullContent,
          assistantMessageId: assistantMsgId,
        })
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })
  /*  end: LangChain 流式 SSE — chat 模式 */

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
