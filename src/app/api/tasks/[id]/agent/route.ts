/* PATCH /api/tasks/[id]/agent — 切换任务的 Agent */
import { NextRequest, NextResponse } from 'next/server'
import { updateTaskAgent, getTask } from '@/core/storage/task/store'
import type { TaskType } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as TaskType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    const body = await req.json()
    const { agentName } = body

    if (!agentName?.trim()) {
      return NextResponse.json({ error: 'agentName 不能为空' }, { status: 400 })
    }

    let task = null
    if (type === 'workspace' && workspaceId) {
      // 工作空间任务
      task = getTask(id, workspaceId)
      if (task) {
        task.agentName = agentName.trim()
        task.updatedAt = new Date().toISOString()
        // 重新写入
        const { writeTask } = await import('@/core/storage/task/store')
        writeTask(task)
      }
    } else {
      // 全局任务
      task = updateTaskAgent(id, agentName.trim())
    }

    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
