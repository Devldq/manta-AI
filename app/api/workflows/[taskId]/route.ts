/*  start: 工作流执行实例详情 API — GET /api/workflows/[taskId]（查询）*/
import { NextRequest, NextResponse } from 'next/server'
import { getExecution } from '@/core/workflow-engine/executor'
import { findWorkflow } from '@/core/workflow-engine/loader'

/** GET /api/workflows/[taskId] — 查询单个任务的工作流执行状态 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  try {
    const exec = getExecution(taskId)
    if (!exec) {
      return NextResponse.json({ error: '未找到执行实例' }, { status: 404 })
    }

    // AI: 附加工作流定义信息（步骤配置用于 UI 展示）
    const workflow = findWorkflow(exec.workflowId)

    return NextResponse.json({ execution: exec, workflow })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流执行实例详情 API 结束 */
