/* POST /api/conversations — 创建新会话, GET /api/conversations — 获取会话列表 */
import { NextRequest, NextResponse } from 'next/server'
import { createConversation, listConversations } from '@storage/conversation/store'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    let conversations = listConversations()

    // 按工作空间过滤（若指定）
    if (workspaceId) {
      conversations = conversations.filter((c) => c.workspaceId === workspaceId)
    }

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
