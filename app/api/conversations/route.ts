/* POST /api/conversations — 创建新会话, GET /api/conversations — 获取会话列表 */
import { NextRequest, NextResponse } from 'next/server'
import { createConversation, listConversations } from '@/core/conversation/store'

export async function GET() {
  try {
    const conversations = listConversations()
    return NextResponse.json({ conversations })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { agentName, title } = body

    if (!agentName?.trim()) {
      return NextResponse.json({ error: 'agentName 不能为空' }, { status: 400 })
    }

    const conv = createConversation(agentName.trim(), title?.trim())
    return NextResponse.json({ conversation: conv }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
