import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE, ensureDir } from '@/lib/dataStore'
import type { Task, TaskStatus } from '@/lib/types'
import path from 'path'

// AI: GET /api/tasks — 获取任务列表，支持 status/workflowId 过滤
export async function GET(req: Request) {
  ensureDir(path.dirname(TASKS_FILE))
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') as TaskStatus | null
  const workflowId = searchParams.get('workflowId')
  const filtered = tasks.filter(t => {
    if (status && t.status !== status) return false
    if (workflowId && t.workflowId !== workflowId) return false
    return true
  })
  return NextResponse.json(filtered)
}

// AI: POST /api/tasks — 创建新任务
export async function POST(req: Request) {
  ensureDir(path.dirname(TASKS_FILE))
  const body = await req.json()
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const now = new Date().toISOString()
  const newTask: Task = {
    id: crypto.randomUUID(),
    title: body.title ?? '未命名任务',
    description: body.description ?? '',
    workflowId: body.workflowId ?? 'dev-standard',
    status: 'Inbox',
    requirementDoc: body.requirementDoc,
    backendDesign: body.backendDesign,
    repos: body.repos ?? [],
    createdAt: now,
    updatedAt: now,
    history: [],
  }
  tasks.push(newTask)
  writeJson(TASKS_FILE, tasks)
  return NextResponse.json(newTask, { status: 201 })
}
