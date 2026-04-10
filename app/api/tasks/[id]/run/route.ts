/* AI start: 重新调度任务执行 API — POST /api/tasks/[id]/run
 * 用于将 inbox/failed 状态的任务重新交给 Runner 执行
 */
import { NextRequest, NextResponse } from 'next/server'
import { dataStore } from '@/core/workflow-engine'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const task = await dataStore.getTask(id)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (task.status !== 'inbox' && task.status !== 'failed') {
      return NextResponse.json(
        { error: `任务当前状态为 "${task.status}"，只有 inbox/failed 状态的任务可以重新执行` },
        { status: 400 }
      )
    }

    // AI: 重置状态为 inbox 再重新 dispatch
    await dataStore.updateTask(id, { status: 'inbox', error: undefined })

    if (task.mode === 'lightweight' && task.agentName) {
      const { runLightweightTask } = await import('@/core/workflow-engine')
      setImmediate(() => {
        runLightweightTask(task).catch((err) => {
          console.error('[run-api] dispatch error:', err)
          dataStore.updateTask(id, { status: 'failed', error: String(err) })
        })
      })
    } else if (task.mode === 'workflow' && task.workflowId) {
      setImmediate(async () => {
        try {
          const { startWorkflow } = await import('@/core/workflow-engine/executor')
          const { findWorkflow } = await import('@/core/workflow-engine/loader')
          const workflow = findWorkflow(task.workflowId!)
          if (!workflow) {
            await dataStore.updateTask(id, {
              status: 'failed',
              error: `工作流 "${task.workflowId}" 不存在`,
            })
            return
          }
          await startWorkflow(task, workflow, dataStore)
        } catch (err) {
          console.error('[run-api] workflow dispatch error:', err)
          dataStore.updateTask(id, { status: 'failed', error: String(err) })
        }
      })
    } else {
      return NextResponse.json({ error: '任务配置不完整，无法执行' }, { status: 400 })
    }

    const updated = await dataStore.getTask(id)
    return NextResponse.json({ task: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/* AI end: 重新调度任务执行 API 结束 */
