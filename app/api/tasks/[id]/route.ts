/*  start: 单任务 API — GET/PATCH/DELETE /api/tasks/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { dataStore, advanceTaskStatus } from '@/core/workflow-engine'
import { getExecution } from '@/core/workflow-engine/executor'
import { findWorkflow } from '@/core/workflow-engine/loader'
import type { TaskStatus } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const task = await dataStore.getTask(id)
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    // AI: 工作流任务附加执行实例 + 工作流定义
    if (task.mode === 'workflow') {
      const exec = getExecution(id)
      const workflow = exec ? findWorkflow(exec.workflowId) : null
      return NextResponse.json({ task, workflowExecution: exec ?? null, workflow: workflow ?? null })
    }

    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const body = await req.json()
    const { status, title, description, score } = body

    const patch: Record<string, unknown> = {}
    if (title) patch.title = title
    if (description !== undefined) patch.description = description
    // AI: 支持保存评分（1-10 整数）
    if (score !== undefined) {
      const s = Number(score)
      if (!isNaN(s) && s >= 1 && s <= 10) patch.score = Math.round(s)
    }
    if (status) {
      // AI: 验证状态值合法性
      const validStatuses: TaskStatus[] = ['inbox', 'planning', 'running', 'done', 'failed', 'archived']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: `无效状态: ${status}` }, { status: 400 })
      }
      patch.status = status
    }

    const task = await dataStore.updateTask(id, patch as Partial<import('@/core/types').Task>)
    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    await dataStore.deleteTask(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 单任务 API 结束 */
