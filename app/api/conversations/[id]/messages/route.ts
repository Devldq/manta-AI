/* POST /api/conversations/[id]/messages — 发送消息，创建 Task 并执行 */
import { NextRequest, NextResponse } from 'next/server'
import { getConversation, appendMessage } from '@/core/conversation/store'
import { createAndDispatch } from '@/core/workflow-engine'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const conv = getConversation(id)
    if (!conv) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }

    const body = await req.json()
    const { content, hideTask } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 })
    }

    // AI: 1. 追加用户消息到会话
    const userResult = appendMessage(id, 'user', content.trim())
    if (!userResult) {
      return NextResponse.json({ error: '追加消息失败' }, { status: 500 })
    }

    // AI: 2. 将历史对话拼入 description，让 Agent 携带上下文执行
    const history = conv.messages
      .filter((m) => m.content.trim())  // 过滤空占位消息
      .slice(-20)                        // 最近 20 条，避免过长
      .map((m) => `[${m.role === 'user' ? '用户' : 'Assistant'}]: ${m.content.trim()}`)
      .join('\n')

    const description = history
      ? `以下是当前对话历史，请基于上下文继续执行：\n\n${history}\n\n---\n用户最新消息：${content.trim()}`
      : content.trim()

    // AI: 3. 创建 Task（轻量模式，使用会话当前 Agent）
    // AI: hideTask=true 时设置 hidden 标志，/api/tasks 会过滤掉，不在侧边栏显示
    const task = await createAndDispatch({
      title: content.trim().slice(0, 60),
      description,
      mode: 'lightweight',
      agentName: conv.agentName,
      status: 'inbox',
      hidden: hideTask === true ? true : undefined,
    })

    // AI: 4. 追加一条占位 assistant 消息（内容在流式端点更新）
    const assistantResult = appendMessage(id, 'assistant', '', task.id)

    return NextResponse.json({
      message: userResult.message,
      assistantMessage: assistantResult?.message ?? null,
      task,
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
