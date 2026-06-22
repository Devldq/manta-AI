/* GET/DELETE/PATCH /api/tasks/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { getTask, deleteTask, updateTaskTitle } from '@/core/storage/task/store'
import type { TaskType } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as TaskType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    let task = null
    if (type === 'workspace' && workspaceId) {
      task = getTask(id, workspaceId)
    } else {
      task = getTask(id)
    }
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as TaskType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    let ok = false
    if (type === 'workspace' && workspaceId) {
      ok = deleteTask(id, workspaceId)
    } else {
      ok = deleteTask(id)
    }
    if (!ok) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') as TaskType) || 'global'
  const workspaceId = searchParams.get('workspaceId') ?? undefined

  try {
    const body = await req.json()
    const { title } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title 不能为空' }, { status: 400 })
    }

    let task = null
    if (type === 'workspace' && workspaceId) {
      task = updateTaskTitle(id, title.trim(), workspaceId)
    } else {
      task = updateTaskTitle(id, title.trim())
    }

    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
