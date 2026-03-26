import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE, ensureDir } from '@/lib/dataStore'
import type { Task } from '@/lib/types'
import path from 'path'

// AI: DELETE /api/tasks/:id/delete — 软删除任务（标记 deletedAt，不真正删除）
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  ensureDir(path.dirname(TASKS_FILE))
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  // AI: 软删除 — 写入 deletedAt 时间戳
  tasks[idx] = { ...tasks[idx], deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  writeJson(TASKS_FILE, tasks)
  return NextResponse.json(tasks[idx])
}

// AI: POST /api/tasks/:id/delete — 恢复已删除任务（清除 deletedAt）
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  ensureDir(path.dirname(TASKS_FILE))
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === id)
  if (idx === -1) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  // AI: 恢复删除 — 清除 deletedAt
  const restored = { ...tasks[idx] }
  delete restored.deletedAt
  restored.updatedAt = new Date().toISOString()
  tasks[idx] = restored
  writeJson(TASKS_FILE, tasks)
  return NextResponse.json(tasks[idx])
}
