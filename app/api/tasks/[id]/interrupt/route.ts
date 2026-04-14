/*  start: 任务打断 API — POST /api/tasks/[id]/interrupt */
import { NextRequest, NextResponse } from 'next/server'
import { dataStore } from '@/core/workflow-engine'
import { processRegistry } from '@/core/runner/process-registry'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const task = await dataStore.getTask(id)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // AI: 强制停止进程
    await processRegistry.kill(id)
    console.log(`[interrupt] 已强制停止任务 ${id} 的进程`)

    // AI: 更新任务状态
    const updated = await dataStore.updateTask(id, {
      status: 'failed',
      error: '用户中断',
    })

    return NextResponse.json({ ok: true, task: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 任务打断 API 结束 */
