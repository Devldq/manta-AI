/*  start: 任务日志 API — GET /api/tasks/[id]/logs */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { dataStore } from '@/core/workflow-engine'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const task = await dataStore.getTask(id)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (!task.outputDir) {
      return NextResponse.json({ logs: '', hasMore: false })
    }

    // AI: 展开 ~ 到实际路径
    const outputDir = task.outputDir.startsWith('~')
      ? task.outputDir.replace('~', os.homedir())
      : task.outputDir

    const logFile = path.join(outputDir, 'runner.log')

    if (!fs.existsSync(logFile)) {
      return NextResponse.json({ logs: '', hasMore: false })
    }

    // AI: 读取日志文件（最多 200KB，避免内存溢出）
    const logs = fs.readFileSync(logFile, 'utf-8').slice(0, 200 * 1024)

    return NextResponse.json({ logs, hasMore: false })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 任务日志 API 结束 */
