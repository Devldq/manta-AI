import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE } from '@/lib/dataStore'
import { validateTransition } from '@/lib/workflowEngine'
import type { Task, TaskStatus, TaskHistoryEntry } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

// AI: PUT /api/tasks/[id]/status — 状态流转（走状态机校验）
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params
  const { status, agent = 'system', note } = await req.json()
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  const task = tasks[idx]
  try {
    validateTransition(task.status, status as TaskStatus)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const entry: TaskHistoryEntry = {
    from: task.status,
    to: status,
    agent,
    note,
    timestamp: new Date().toISOString(),
  }
  task.history.push(entry)
  task.status = status
  task.updatedAt = new Date().toISOString()
  writeJson(TASKS_FILE, tasks)
  return NextResponse.json(task)
}
