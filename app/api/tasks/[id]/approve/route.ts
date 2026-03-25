import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE } from '@/lib/dataStore'
import { sendMacNotification } from '@/lib/macNotify'
import type { Task, TaskHistoryEntry } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

// AI: POST /api/tasks/[id]/approve — 人工审批（approve 通过 / reject 退回）
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const { action, note } = await req.json() // action: 'approve' | 'reject'
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  const task = tasks[idx]
  if (task.status !== 'PendingApproval') {
    return NextResponse.json({ error: '任务当前不在待审批状态' }, { status: 400 })
  }

  const toStatus = action === 'approve' ? 'Developing' : 'Architecting'
  const entry: TaskHistoryEntry = {
    from: 'PendingApproval',
    to: toStatus,
    agent: 'you',
    note: note ?? (action === 'approve' ? '审批通过' : '退回重做'),
    timestamp: new Date().toISOString(),
  }
  task.history.push(entry)
  task.status = toStatus
  task.updatedAt = new Date().toISOString()
  writeJson(TASKS_FILE, tasks)

  // AI: 推送 Mac 通知
  if (action === 'approve') {
    await sendMacNotification({
      title: '✅ 审批通过',
      message: `${task.title} 已派发给开发工程师`,
      taskId: id,
      type: 'approval',
    })
  }

  return NextResponse.json(task)
}
