import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE } from '@/lib/dataStore'
import { advanceWorkflowStep, findStep, loadWorkflow } from '@/lib/workflowEngine'
import { triggerAgent } from '@/lib/agentTrigger'
import { sendMacNotification } from '@/lib/macNotify'
import type { Task } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

/* AI start: POST /api/tasks/[id]/approve — 人工审批工作流中的 human_in_loop 步骤
 * - approve：推进到工作流中 actions.approve 定义的下一步，触发对应 agent
 * - reject：退回到 actions.reject 定义的步骤，重新触发上一个 agent
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const { action, note } = await req.json() // action: 'approve' | 'reject'

  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  const task = tasks[idx]

  // AI: 必须绑定工作流才能走审批流程
  if (!task.workflowId || !task.workflowStep) {
    return NextResponse.json({ error: '任务未绑定工作流或当前步骤未知' }, { status: 400 })
  }

  const workflow = loadWorkflow(task.workflowId)
  if (!workflow) {
    return NextResponse.json({ error: `工作流 ${task.workflowId} 不存在` }, { status: 404 })
  }

  const currentStep = findStep(workflow, task.workflowStep)
  if (!currentStep) {
    return NextResponse.json({ error: `步骤 ${task.workflowStep} 不存在` }, { status: 400 })
  }

  if (currentStep.type !== 'human_in_loop') {
    return NextResponse.json({ error: `步骤 ${task.workflowStep} 不是 human_in_loop 步骤，无法审批` }, { status: 400 })
  }

  const actions = currentStep.actions ?? {}
  const nextStepId = action === 'approve' ? actions.approve : actions.reject
  if (!nextStepId) {
    return NextResponse.json({ error: `步骤 ${task.workflowStep} 未定义 ${action} 动作` }, { status: 400 })
  }

  // AI: 推进工作流到目标步骤，传入 overrideNextStepId 直接跳到 actions 指定的步骤
  const auditNote = note ?? (action === 'approve' ? '审批通过' : '退回重做')

  try {
    const result = await advanceWorkflowStep(
      id,
      task.workflowStep,
      `[${action === 'approve' ? '✅ 审批通过' : '❌ 退回'}] ${auditNote}`,
      'you',
      nextStepId,  // AI: 明确告知引擎下一步，而非靠 currentStep.next 自动推导
    )

    // AI: 异步触发下一个 agent
    if (result.triggerAgentId && result.triggerMessage) {
      setImmediate(() => {
        try {
          if (result.triggerAgentId!.startsWith('parallel:')) {
            const agentIds = result.triggerAgentId!.replace('parallel:', '').split(',')
            for (const agentId of agentIds) {
              triggerAgent(agentId.trim(), result.triggerMessage!)
            }
          } else {
            triggerAgent(result.triggerAgentId!, result.triggerMessage!)
          }
        } catch (err) {
          console.error('[ARM] 审批后触发 agent 失败:', err)
        }
      })
    }

    // AI: 推送审批结果通知
    const actionLabel = action === 'approve' ? '✅ 审批通过' : '❌ 已退回'
    const nextStepName = result.nextStep?.name ?? (action === 'approve' ? '下一步' : '重新执行')
    await sendMacNotification({
      title: `${actionLabel}：${task.title}`,
      message: `→ ${nextStepName}`,
      taskId: id,
      type: 'approval',
    })

    return NextResponse.json({
      task: result.task,
      action,
      nextStep: result.nextStep?.id ?? null,
      nextStepName: result.nextStep?.name ?? null,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
/* AI end: 人工审批接口 */
