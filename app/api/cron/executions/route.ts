import { NextResponse } from 'next/server'
import { readJson, ensureDir } from '@/lib/dataStore'
import type { ExecutionRecord } from '@/lib/types'
import path from 'path'

const CRON_EXECUTIONS_FILE = path.join(process.cwd(), 'data', 'cron-executions.json')

// GET /api/cron/executions - 获取执行历史
export async function GET(req: Request) {
  ensureDir(path.dirname(CRON_EXECUTIONS_FILE))
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '10', 10)
  const taskId = searchParams.get('taskId')

  const executions = readJson<ExecutionRecord[]>(CRON_EXECUTIONS_FILE, [])
  
  let filtered = executions
  if (taskId) {
    filtered = executions.filter(e => e.taskId === taskId)
  }

  // 按时间倒序排列，限制数量
  filtered = filtered
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)

  return NextResponse.json(filtered)
}
