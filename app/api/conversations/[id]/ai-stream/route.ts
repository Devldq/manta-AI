/* POST /api/conversations/[id]/ai-stream — Vercel AI SDK v6 流式聊天 */
import { NextRequest } from 'next/server'
import { streamText } from 'ai'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getConversation, appendMessage } from '@/core/conversation/store'
import { conversationTools } from '@/core/conversation/tools'
import { fsTools } from '@/core/conversation/fs-tools'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** 读取指定 agent 的 SOUL.md 作为 system prompt */
function readAgentSoul(agentName: string): string | null {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) return null
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; name?: string; workspace?: string }> = config?.agents?.list ?? []
    const entry = list.find((a) => a.id === agentName || a.name === agentName)
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

/** 从 UI Message parts 中提取文本 */
function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const conv = getConversation(id)
  if (!conv) {
    return new Response(JSON.stringify({ error: '会话不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // AI SDK v6 DefaultChatTransport 发送格式：{ messages: UIMessage[] }
  let body: {
    messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>
    agentName?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体解析失败' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { messages, agentName: bodyAgentName } = body
  if (!messages?.length) {
    return new Response(JSON.stringify({ error: 'messages 不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 检查 LLM 配置
  const llmConfig = getLLMConfig()
  if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
    return new Response(
      JSON.stringify({ error: 'LLM 未配置 API Key，请前往 Settings → AI 模型 进行配置' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const effectiveAgentName = bodyAgentName || conv.agentName
  const systemPrompt = readAgentSoul(effectiveAgentName)

  try {
    const model = await getAISDKModel()

    // 将 UIMessage[] 转为 CoreMessage 格式供 streamText 使用
    const coreMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.parts
          ? extractText(m.parts as Array<{ type: string; text?: string }>)
          : (m.content ?? ''),
      }))
      .filter((m) => m.content)

    const result = streamText({
      model,
      system: systemPrompt ?? undefined,
      messages: coreMessages,
      tools: { ...conversationTools, ...fsTools },
      temperature: llmConfig.temperature ?? 0.7,
      onFinish: async ({ text }) => {
        // 持久化：最后一条 user 消息 + assistant 回复
        const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg?.content) {
          appendMessage(id, 'user', lastUserMsg.content)
        }
        if (text) {
          appendMessage(id, 'assistant', text)
        }
      },
    })

    // 使用 streamText 内置的 toUIMessageStreamResponse
    return result.toUIMessageStreamResponse()
  } catch (err) {
    console.error('[ai-stream] fatal error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
