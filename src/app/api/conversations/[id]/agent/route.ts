/* PATCH /api/conversations/[id]/agent — 切换会话的 Agent */
import { NextRequest, NextResponse } from 'next/server'
import { updateConversationAgent, getConversation } from '@storage/conversation/store'
import { getWorkspaceConversation, updateWorkspaceConversation } from '@storage/workspace/store'
import type { ConversationType } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as ConversationType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    const body = await req.json()
    const { agentName } = body

    if (!agentName?.trim()) {
      return NextResponse.json({ error: 'agentName 不能为空' }, { status: 400 })
    }

    let conv = null
    if (type === 'workspace' && workspaceId) {
      // 工作空间会话
      conv = getWorkspaceConversation(workspaceId, id)
      if (conv) {
        conv.agentName = agentName.trim()
        conv.updatedAt = new Date().toISOString()
        updateWorkspaceConversation(workspaceId, id, conv)
      }
    } else {
      // 全局会话
      conv = updateConversationAgent(id, agentName.trim())
    }

    if (!conv) return NextResponse.json({ error: '会话不存在' }, { status: 404 })

    return NextResponse.json({ conversation: conv })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
