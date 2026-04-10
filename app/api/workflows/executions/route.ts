/*  start: 工作流执行实例 API — GET /api/workflows/executions（查询所有执行实例）*/
import { NextResponse } from 'next/server'
import { getAllExecutions } from '@/core/workflow-engine/executor'
import { dataStore } from '@/core/workflow-engine'

/** GET /api/workflows/executions — 返回所有工作流执行实例（附加任务标题） */
export async function GET() {
  try {
    const executions = getAllExecutions()

    // AI: 批量获取任务，为执行记录附加 taskTitle
    const tasks = await dataStore.getTasks()
    const taskMap = new Map(tasks.map((t) => [t.id, t.title]))

    const result = executions.map((e) => ({
      ...e,
      taskTitle: taskMap.get(e.taskId) ?? null,
    }))

    return NextResponse.json({ executions: result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流执行实例 API 结束 */
