/*  start: 工作流列表 API — GET /api/workflows（查询）, POST /api/workflows（创建执行） */
import { NextRequest, NextResponse } from 'next/server'
import { loadAllWorkflows } from '@/core/workflow-engine/loader'
import { getAllExecutions } from '@/core/workflow-engine/executor'

/** GET /api/workflows — 返回所有工作流定义 + 每个工作流最近的执行实例 */
export async function GET() {
  try {
    const workflows = loadAllWorkflows()
    const executions = getAllExecutions()

    // AI: 为每个工作流附加最近一次执行状态
    const result = workflows.map((wf) => {
      const related = executions.filter((e) => e.workflowId === wf.id)
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
