import { NextResponse } from 'next/server'
import { readJson, TASKS_FILE, agentTasksDir, readText, AGENTS_DIR } from '@/lib/dataStore'
import type { Task } from '@/lib/types'
import fs from 'fs'
import path from 'path'

// AI: GET /api/archive — 获取已完成任务归档列表（含各 Agent 产出）
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('agentId')

  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const archived = tasks.filter(t => t.status === 'Done')

  const result = archived.map(task => {
    const outputs: Record<string, string> = {}
    for (const aid of ['architect', 'dev', 'qa', 'review']) {
      if (agentId && aid !== agentId) continue
      const filePath = path.join(agentTasksDir(aid), `${task.id}.md`)
      if (fs.existsSync(filePath)) {
        outputs[aid] = readText(filePath)
      }
    }
    return { ...task, outputs }
  })

  return NextResponse.json(result)
}
