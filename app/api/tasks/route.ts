/*  start: 任务列表 API — GET /api/tasks（查询）, POST /api/tasks（创建）*/
import { NextRequest, NextResponse } from 'next/server'
import { dataStore, createAndDispatch } from '@/core/workflow-engine'
import type { TaskMode } from '@/core/types'

export async function GET() {
  try {
    const tasks = await dataStore.getTasks()
    // AI: 按更新时间降序排列
    const sorted = tasks.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    return NextResponse.json({ tasks: sorted })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, description, mode, agentName, workflowId } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: '任务标题不能为空' }, { status: 400 })
    }

    const taskMode: TaskMode = mode === 'workflow' ? 'workflow' : 'lightweight'

    const task = await createAndDispatch({
      title: title.trim(),
      description: description?.trim(),
      mode: taskMode,
      agentName: taskMode === 'lightweight' ? agentName : undefined,
      workflowId: taskMode === 'workflow' ? workflowId : undefined,
      status: 'inbox',
    })

    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 任务列表 API 结束 */
