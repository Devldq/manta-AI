import { NextResponse } from 'next/server'
import { readJson, writeJson, ensureDir } from '@/lib/dataStore'
import type { CronTask, ExecutionRecord } from '@/lib/types'
import path from 'path'
import { randomUUID } from 'crypto'

const CRON_TASKS_FILE = path.join(process.cwd(), 'data', 'cron-tasks.json')
const CRON_EXECUTIONS_FILE = path.join(process.cwd(), 'data', 'cron-executions.json')

// 计算下次执行时间（简化版）
function calculateNextRun(cronExpression: string): string | undefined {
  // 简化实现：返回当前时间 + 1小时
  const now = new Date()
  now.setHours(now.getHours() + 1)
  return now.toISOString()
}

// GET /api/cron - 获取所有定时任务
export async function GET() {
  ensureDir(path.dirname(CRON_TASKS_FILE))
  const tasks = readJson<CronTask[]>(CRON_TASKS_FILE, [])
  return NextResponse.json(tasks)
}

// POST /api/cron - 创建新定时任务
export async function POST(req: Request) {
  ensureDir(path.dirname(CRON_TASKS_FILE))
  const body = await req.json()
  const tasks = readJson<CronTask[]>(CRON_TASKS_FILE, [])
  const now = new Date().toISOString()

  const newTask: CronTask = {
    id: randomUUID(),
    name: body.name,
    description: body.description || '',
    cronExpression: body.cronExpression,
    command: body.command,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    nextRunAt: calculateNextRun(body.cronExpression),
    runCount: 0,
    failCount: 0,
  }

  tasks.push(newTask)
  writeJson(CRON_TASKS_FILE, tasks)

  return NextResponse.json(newTask, { status: 201 })
}

// PUT /api/cron/:id - 更新定时任务
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { id } = params
  ensureDir(path.dirname(CRON_TASKS_FILE))
  const tasks = readJson<CronTask[]>(CRON_TASKS_FILE, [])
  const body = await req.json()

  const index = tasks.findIndex(t => t.id === id)
  if (index === -1) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  tasks[index] = {
    ...tasks[index],
    ...body,
    updatedAt: new Date().toISOString(),
    nextRunAt: body.cronExpression ? calculateNextRun(body.cronExpression) : tasks[index].nextRunAt,
  }

  writeJson(CRON_TASKS_FILE, tasks)
  return NextResponse.json(tasks[index])
}
