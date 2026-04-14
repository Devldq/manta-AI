/*  start: 任务列表 API — GET /api/tasks（查询）, POST /api/tasks（创建）*/
import { NextRequest, NextResponse } from 'next/server'
import { dataStore, createAndDispatch } from '@/core/workflow-engine'
import { getAllExecutions } from '@/core/workflow-engine/executor'
import { findWorkflow } from '@/core/workflow-engine/loader'
import type { TaskMode } from '@/core/types'

export async function GET() {
  try {
    const tasks = await dataStore.getTasks()
    // AI: 过滤掉对话内聊天产生的隐藏任务
    const visible = tasks.filter((t) => !t.hidden)
    // AI: 按更新时间降序排列
    const sorted = visible.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    // AI: 对工作流任务，附加执行摘要（当前步骤名 + 步骤状态圆点数组）
    const executions = getAllExecutions()
    const tasksWithProgress = sorted.map((task) => {
      if (task.mode !== 'workflow' || !task.workflowId) return task

      const exec = executions.find((e) => e.taskId === task.id)
      if (!exec) return task

      const workflow = findWorkflow(exec.workflowId)
      const currentStep = workflow?.steps.find((s) => s.id === exec.currentStepId)

      // AI: 只取顶层步骤（不含 parallel 子分支）作为圆点展示
      const stepsDot = exec.steps
        .filter((sl) => workflow?.steps.some((ws) => ws.id === sl.stepId))
        .map((sl) => sl.status)

      return {
        ...task,
        _wfProgress: {
          execStatus: exec.status,
          currentStepName: currentStep?.name ?? null,
          currentStepType: currentStep?.type ?? null,
          stepsDot,
        },
      }
    })

    return NextResponse.json({ tasks: tasksWithProgress })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, description, mode, agentName, workflowId, workDir } = body

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
      // AI: 工作目录（可选），传入后将附加到提示词并作为 CLI 的 cwd
      workDir: workDir?.trim() || undefined,
      status: 'inbox',
    })

    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 任务列表 API 结束 */
