import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE } from '@/lib/dataStore'
import { validateTransition, markCurrentStepRunning, loadWorkflow, findStep } from '@/lib/workflowEngine'
import { triggerAgent, resolveAgentForTask, buildTriggerMessage } from '@/lib/agentTrigger'
import type { Task, TaskStatus, TaskHistoryEntry } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

/* AI start: 旧状态迁移映射 — 兼容状态系统重构前遗留的历史数据 */
const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  Architecting: 'InProgress',
  PendingApproval: 'InProgress',
  Developing: 'InProgress',
  ParallelReview: 'InProgress',
  PendingScore: 'Done',
}
/* AI end: 旧状态迁移映射 */

// AI: PUT /api/tasks/[id]/status — 状态流转（走状态机校验）
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params
  const { status, agent = 'system', note } = await req.json()
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  const task = tasks[idx]

  // AI: 若任务当前是遗留旧状态，先自动迁移到对应新状态，再走正常流转
  if (LEGACY_STATUS_MAP[task.status]) {
    const migratedStatus = LEGACY_STATUS_MAP[task.status]
    task.history.push({
      from: task.status,
      to: migratedStatus,
      agent: 'system-migration',
      note: '旧状态自动迁移',
      timestamp: new Date().toISOString(),
    } as TaskHistoryEntry)
    task.status = migratedStatus
  }

  try {
    validateTransition(task.status, status as TaskStatus)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // AI: 工作流保护 — 若任务绑定了工作流且 agent 想直接标记 Done，检查工作流是否真的走完了
  // 防止 agent 违规调用 status API 绕过 pending_approval 等 human_in_loop 步骤
  if (status === 'Done' && agent.startsWith('arm-') && task.workflowId) {
    const workflow = loadWorkflow(task.workflowId)
    if (workflow) {
      // AI: 找到工作流中最后一个步骤，只有完成了最后步骤才允许 Done
      const lastStep = workflow.steps[workflow.steps.length - 1]
      const currentStep = task.workflowStep ? findStep(workflow, task.workflowStep) : null
      const isLastStep = currentStep?.id === lastStep?.id || task.workflowStep === lastStep?.id
      if (!isLastStep) {
        return NextResponse.json({
          error: `工作流任务禁止直接标记 Done！当前步骤: ${task.workflowStep ?? '未知'}，请调用 POST /api/tasks/${id}/advance-step 推进工作流。`,
        }, { status: 403 })
      }
    }
  }

  const entry: TaskHistoryEntry = {
    from: task.status,
    to: status,
    agent,
    note,
    timestamp: new Date().toISOString(),
  }
  task.history.push(entry)
  task.status = status as TaskStatus
  task.updatedAt = new Date().toISOString()

  // AI: agent 认领任务（Inbox→InProgress）时，标记当前工作流步骤为 running
  if (status === 'InProgress' && agent.startsWith('arm-')) {
    markCurrentStepRunning(task, agent)
  }

  writeJson(TASKS_FILE, tasks)

  /* AI start: 状态流转后异步触发对应 agent — 不阻塞 API 响应 */
  const updatedTask = tasks[idx]
  setImmediate(() => {
    try {
      // AI: 人工操作产生的流转（agent='you'）也触发；agent 自身的回写不再重复触发
      const isAgentSelf = agent.startsWith('arm-')
      if (!isAgentSelf) {
        const agentId = updatedTask.assignedAgent || resolveAgentForTask(updatedTask, status)
        if (agentId) {
          const message = buildTriggerMessage(updatedTask, 'status_changed', status)
          triggerAgent(agentId, message)
        }
      }
    } catch (err) {
      console.error('[ARM] 状态流转触发 agent 失败:', err)
    }
  })
  /* AI end: 状态流转后异步触发对应 agent */

  return NextResponse.json(updatedTask)
}
