/* GET/DELETE/PATCH /api/conversations/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { getConversation, deleteConversation, updateConversationTitle } from '@storage/conversation/store'
import { getWorkspaceConversation, deleteWorkspaceConversation, updateWorkspaceConversationTitle } from '@storage/workspace/store'
import type { ConversationType } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as ConversationType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    let conv = null
    if (type === 'workspace' && workspaceId) {
      conv = getWorkspaceConversation(workspaceId, id)
    } else {
      conv = getConversation(id)
    }
    if (!conv) return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as ConversationType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    let ok = false
    if (type === 'workspace' && workspaceId) {
      ok = deleteWorkspaceConversation(workspaceId, id)
    } else {
      ok = deleteConversation(id)
    }
    if (!ok) return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as ConversationType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    const body = await req.json()
    const { title } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title 不能为空' }, { status: 400 })
    }

    let conv = null
    if (type === 'workspace' && workspaceId) {
      conv = updateWorkspaceConversationTitle(workspaceId, id, title.trim())
    } else {
      conv = updateConversationTitle(id, title.trim())
    }

    if (!conv) return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
