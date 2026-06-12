/* PATCH /api/conversations/[id]/agent — 切换会话的 Agent */
import { NextRequest, NextResponse } from 'next/server'
import { updateConversationAgent } from '@storage/conversation/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const body = await req.json()
    const { agentName } = body

    if (!agentName?.trim()) {
      return NextResponse.json({ error: 'agentName 不能为空' }, { status: 400 })
    }

    const conv = updateConversationAgent(id, agentName.trim())
    if (!conv) return NextResponse.json({ error: '会话不存在' }, { status: 404 })

    return NextResponse.json({ conversation: conv })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
