import { NextResponse } from 'next/server'
import { readJson, writeJson, ensureDir } from '@/lib/dataStore'
import type { CronTask, ExecutionRecord } from '@/lib/types'
import path from 'path'
import { randomUUID } from 'crypto'

const CRON_TASKS_FILE = path.join(process.cwd(), 'data', 'cron-tasks.json')
const CRON_EXECUTIONS_FILE = path.join(process.cwd(), 'data', 'cron-executions.json')

// POST /api/cron/:id/toggle - 启用/禁用任务
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const url = new URL(req.url)
  const action = url.pathname.split('/').pop()

  ensureDir(path.dirname(CRON_TASKS_FILE))
  const tasks = readJson<CronTask[]>(CRON_TASKS_FILE, [])

  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (action === 'toggle') {
    tasks[index].enabled = !tasks[index].enabled
    tasks[index].updatedAt = new Date().toISOString()
    writeJson(CRON_TASKS_FILE, tasks)
    return NextResponse.json(tasks[index])
  }

  if (action === 'run') {
    // 模拟执行任务
    const now = new Date().toISOString()
    const execution: ExecutionRecord = {
      id: randomUUID(),
      taskId: id,
      taskName: tasks[index].name,
      startedAt: now,
      status: 'success',
      duration: Math.floor(Math.random() * 5000),
    }

    ensureDir(path.dirname(CRON_EXECUTIONS_FILE))
    const executions = readJson<ExecutionRecord[]>(CRON_EXECUTIONS_FILE, [])
    executions.unshift(execution)
    writeJson(CRON_EXECUTIONS_FILE, executions.slice(0, 100)) // 保留最近100条

    tasks[index].lastRunAt = now
    tasks[index].lastRunStatus = 'success'
    tasks[index].runCount++
    writeJson(CRON_TASKS_FILE, tasks)

    return NextResponse.json({ success: true, execution })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

// DELETE /api/cron/:id - 删除定时任务
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  ensureDir(path.dirname(CRON_TASKS_FILE))
  const tasks = readJson<CronTask[]>(CRON_TASKS_FILE, [])

  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  tasks.splice(index, 1)
  writeJson(CRON_TASKS_FILE, tasks)

  return NextResponse.json({ success: true })
}
