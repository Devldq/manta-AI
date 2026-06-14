/* Workspace 下的会话列表 API — GET */

import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/core/storage/workspace/store'
import { listConversations } from '@/core/storage/conversation/store'

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

    // 获取所有会话，过滤属于该工作空间的
    const allConversations = listConversations()
    const conversations = allConversations
      .filter((c) => c.workspaceId === id)
      .map(({ id, title, agentName, createdAt, updatedAt, workspaceId }) => ({
        id, title, agentName, createdAt, updatedAt, workspaceId,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return NextResponse.json({ conversations })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
