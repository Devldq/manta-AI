import { NextResponse } from 'next/server'
import { readJson, TASKS_FILE, agentTasksDir, readText } from '@/lib/dataStore'
import type { Task } from '@/lib/types'

// AI: GET /api/reports/[taskId] — 获取任务的 QA + CR 报告
export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const task = tasks.find(t => t.id === taskId)
  if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  // AI: 从 qa / review 的 tasks 目录读取报告
  const qaReport = readText(`${agentTasksDir('qa')}/${taskId}.md`)
  const reviewReport = readText(`${agentTasksDir('review')}/${taskId}.md`)

  return NextResponse.json({
    taskId,
    title: task.title,
    status: task.status,
    qaReport: qaReport || task.qaReport || '',
    reviewReport: reviewReport || task.reviewReport || '',
    qaDone: task.qaDone ?? !!qaReport,
    reviewDone: task.reviewDone ?? !!reviewReport,
  })
}

// AI: POST /api/reports/[taskId] — 提交报告（qa / review 产出）
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const { agentId, content } = await req.json()
  if (!['qa', 'review'].includes(agentId)) {
    return NextResponse.json({ error: 'agentId 必须是 qa 或 review' }, { status: 400 })
  }

  const { writeJson, readJson: rj, TASKS_FILE: TF, agentTasksDir: atd, ensureDir } = await import('@/lib/dataStore')
  const fs = await import('fs')
  const path = await import('path')

  const tasksDir = atd(agentId)
  ensureDir(tasksDir)
  fs.writeFileSync(path.join(tasksDir, `${taskId}.md`), content, 'utf-8')

  // AI: 更新 task 中的报告字段和完成标记
  const tasks = rj<Task[]>(TF, [])
  const idx = tasks.findIndex(t => t.id === taskId)
  if (idx !== -1) {
    if (agentId === 'qa') {
      tasks[idx].qaReport = content
      tasks[idx].qaDone = true
    } else {
      tasks[idx].reviewReport = content
      tasks[idx].reviewDone = true
    }
    tasks[idx].updatedAt = new Date().toISOString()

    // AI: 报告提交后检查是否需要推进状态
    // 注意：ParallelReview/PendingScore 是自定义工作流中的专属状态，通用流中由工作流引擎决定后续步骤
    // 此处仅发送通知，不强制流转状态（避免破坏通用状态机）
    const t = tasks[idx]
    if (t.qaDone && t.reviewDone) {
      const { sendMacNotification } = await import('@/lib/macNotify')
      await sendMacNotification({
        title: '📊 报告已生成',
        message: `${t.title} 的 QA + CR 报告已就绪`,
        taskId,
        type: 'score',
      })
    }
    writeJson(TF, tasks)
  }

  return NextResponse.json({ ok: true })
}
