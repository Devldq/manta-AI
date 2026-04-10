/*  start: 工作流列表 API — GET /api/workflows（查询）, POST /api/workflows（创建执行） */
import { NextRequest, NextResponse } from 'next/server'
import { loadAllWorkflows } from '@/core/workflow-engine/loader'
import { getAllExecutions } from '@/core/workflow-engine/executor'
import { dataStore } from '@/core/workflow-engine'

/** GET /api/workflows — 返回所有工作流定义 + 每个工作流最近的执行实例 */
export async function GET() {
  try {
    const workflows = loadAllWorkflows()
    const executions = getAllExecutions()

    // AI: 批量获取所有任务，用于为执行记录附加任务标题
    const tasks = await dataStore.getTasks()
    const taskMap = new Map(tasks.map((t) => [t.id, t.title]))

    // AI: 为每个工作流附加最近一次执行状态（含任务标题）
    const result = workflows.map((wf) => {
      const related = executions
        .filter((e) => e.workflowId === wf.id)
        .map((e) => ({ ...e, taskTitle: taskMap.get(e.taskId) ?? null }))
      const latest = related.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0]
      return {
        ...wf,
        latestExecution: latest ?? null,
      }
    })

    return NextResponse.json({ workflows: result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流列表 API 结束 */
