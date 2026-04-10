/*  start: human_in_loop 操作 API — POST /api/workflows/[taskId]/action */
import { NextRequest, NextResponse } from 'next/server'
import { getExecution, applyHumanAction } from '@/core/workflow-engine/executor'
import { findWorkflow } from '@/core/workflow-engine/loader'
import { dataStore } from '@/core/workflow-engine'

/** POST /api/workflows/[taskId]/action
 *  body: { actionKey: 'approve' | 'reject' | 'score' | ... }
 *  用于人工操作 human_in_loop 步骤，推进工作流
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  try {
    const body = await req.json()
    const { actionKey } = body

    if (!actionKey) {
      return NextResponse.json({ error: 'actionKey 不能为空' }, { status: 400 })
    }

    // AI: 查找执行实例
    const exec = getExecution(taskId)
    if (!exec) {
      return NextResponse.json({ error: '未找到执行实例' }, { status: 404 })
    }

    if (exec.status !== 'waiting') {
      return NextResponse.json(
        { error: `执行实例状态为 ${exec.status}，无法执行操作（只能操作 waiting 状态）` },
        { status: 409 }
      )
    }

    // AI: 查找工作流定义
    const workflow = findWorkflow(exec.workflowId)
    if (!workflow) {
      return NextResponse.json({ error: '工作流定义不存在' }, { status: 404 })
    }

    // AI: 找到当前等待中的步骤
    const currentStep = workflow.steps.find((s) => s.id === exec.currentStepId)
    if (!currentStep) {
      return NextResponse.json({ error: '找不到当前步骤' }, { status: 404 })
    }

    if (currentStep.type !== 'human_in_loop') {
      return NextResponse.json(
        { error: `当前步骤 "${currentStep.id}" 类型为 ${currentStep.type}，不是 human_in_loop` },
        { status: 409 }
      )
    }

    // AI: 获取任务
    const task = await dataStore.getTask(taskId)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    // AI: 应用操作，异步推进工作流（不阻塞响应）
    const updated = await applyHumanAction(exec, currentStep, actionKey, workflow, task, dataStore)

    return NextResponse.json({ execution: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: human_in_loop 操作 API 结束 */
