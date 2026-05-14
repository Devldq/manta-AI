/* POST /api/conversations/[id]/ai-stream — Vercel AI SDK v6 流式聊天 */
import { NextRequest } from 'next/server'
import { getConversation } from '@/core/conversation/store'
import { streamChat } from '@/core/chat/stream-handler'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // 验证会话存在
  const conv = getConversation(id)
  if (!conv) {
    return new Response(JSON.stringify({ error: '会话不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 解析请求体
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

  // 使用有效的 agent 名称
  const effectiveAgentName = bodyAgentName || conv.agentName

  try {
    // 调用拆分出的流式处理逻辑，透传 abortSignal 以支持用户中断
    return await streamChat({
      messages,
      agentName: effectiveAgentName,
      conversationId: id,
      abortSignal: req.signal,
    })
  } catch (err) {
    console.error('[ai-stream] fatal error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}