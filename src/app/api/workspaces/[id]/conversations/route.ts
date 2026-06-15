/* Workspace 下的会话列表 API — GET / POST */

import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace, listWorkspaceConversations, createWorkspaceConversation } from '@/core/storage/workspace/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const workspace = getWorkspace(id)
    if (!workspace) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }

    const conversations = listWorkspaceConversations(id)
    return NextResponse.json({ conversations })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const workspace = getWorkspace(id)
    if (!workspace) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }

    const body = await req.json()
    const { agentName = 'default', title } = body

    const conversation = createWorkspaceConversation(id, agentName, title)
    if (!conversation) {
      return NextResponse.json({ error: '创建会话失败' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: { conversation } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
