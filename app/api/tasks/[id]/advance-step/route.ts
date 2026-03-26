import { NextResponse } from 'next/server'
import { advanceWorkflowStep } from '@/lib/workflowEngine'
import { triggerAgent } from '@/lib/agentTrigger'

interface Params { params: Promise<{ id: string }> }

/* AI start: POST /api/tasks/[id]/advance-step — agent 完成当前步骤后推进工作流
 * 这是工作流驱动的核心接口，agent 完成产出后调用此接口，ARM 系统自动：
 *   1. 确定下一个工作流步骤
 *   2. 更新 task.workflowStep 和历史
 *   3. 如果下一步是 human_in_loop → 发 Mac 通知等待审批
 *   4. 如果下一步是 agent 步骤 → 自动触发对应 agent
 *   5. 如果没有下一步 → 标记任务 Done
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const { completedStep, outputNote, agent } = await req.json()

  if (!completedStep) {
    return NextResponse.json({ error: '缺少 completedStep 参数' }, { status: 400 })
  }

  try {
    const result = await advanceWorkflowStep(
      id,
      completedStep,
      outputNote ?? `${agent ?? 'agent'} 完成步骤 ${completedStep}`,
      agent ?? 'system',
    )

    // AI: 异步触发下一个 agent（如果有）
    if (result.triggerAgentId && result.triggerMessage) {
      setImmediate(() => {
        try {
          // AI: 处理并行触发（parallel: 前缀）
          if (result.triggerAgentId!.startsWith('parallel:')) {
            const agentIds = result.triggerAgentId!.replace('parallel:', '').split(',')
            // AI: triggerMessage 格式为 "arm-qa=消息|||arm-review=消息"（每个 agent 的专属消息）
            const msgMap: Record<string, string> = {}
            result.triggerMessage!.split('|||').forEach(part => {
              const eqIdx = part.indexOf('=')
              if (eqIdx > 0) {
                msgMap[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1)
              }
            })
            for (const agentId of agentIds) {
              const msg = msgMap[agentId.trim()] ?? result.triggerMessage!
              triggerAgent(agentId.trim(), msg)
            }
          } else {
            triggerAgent(result.triggerAgentId!, result.triggerMessage!)
          }
        } catch (err) {
          console.error('[ARM] advance-step 触发下一 agent 失败:', err)
        }
      })
    }

    return NextResponse.json({
      task: result.task,
      nextStep: result.nextStep?.id ?? null,
      nextStepName: result.nextStep?.name ?? null,
      nextAgent: result.triggerAgentId,
      notified: result.notified,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
/* AI end: advance-step 工作流推进接口 */
