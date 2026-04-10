/*  start: 工作流执行实例 API — GET /api/workflows/executions（查询所有执行实例）*/
import { NextResponse } from 'next/server'
import { getAllExecutions } from '@/core/workflow-engine/executor'

/** GET /api/workflows/executions — 返回所有工作流执行实例 */
export async function GET() {
  try {
    const executions = getAllExecutions()
    return NextResponse.json({ executions })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流执行实例 API 结束 */
