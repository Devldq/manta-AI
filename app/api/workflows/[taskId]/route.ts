/*  start: 工作流执行实例详情 API — GET/DELETE /api/workflows/[taskId] */
import { NextRequest, NextResponse } from 'next/server'
import { getExecution, cleanupExecution } from '@/core/workflow-engine/executor'
import { findWorkflow } from '@/core/workflow-engine/loader'
import { dataStore } from '@/core/workflow-engine'
import { processRegistry } from '@/core/runner/process-registry'

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

/** DELETE /api/workflows/[taskId] — 删除执行记录（同时停止进程并删除关联任务） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  try {
    // AI: 1. 若进程正在执行，强制停止
    const exec = getExecution(taskId)
    if (exec && (exec.status === 'running' || exec.status === 'waiting')) {
      await processRegistry.kill(taskId)
      console.log(`[workflows/delete] 已强制停止任务 ${taskId} 的 Agent 进程`)
    }

    // AI: 2. 清除工作流执行记录
    cleanupExecution(taskId)

    // AI: 3. 删除关联任务（若任务不存在则忽略）
    try {
      await dataStore.deleteTask(taskId)
    } catch {
      // AI: 任务可能已被删除，忽略此错误
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流执行实例详情 API 结束 */
