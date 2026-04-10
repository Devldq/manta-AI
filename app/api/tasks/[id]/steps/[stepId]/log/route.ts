/*  start: 步骤实时日志 API — GET /api/tasks/[id]/steps/[stepId]/log */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getExecution } from '@/core/workflow-engine/executor'

// AI: 数据目录（与 executor.ts 保持一致）
const DATA_DIR = path.join(os.homedir(), 'manta-data')

interface RouteContext {
  params: Promise<{ id: string; stepId: string }>
}

/**
 * GET /api/tasks/[id]/steps/[stepId]/log?offset=0
 *
 * 增量读取步骤执行日志（runner.log），支持轮询流式展示。
 * - offset: 上次读取到的字节偏移，首次传 0
 * - 返回 offset 之后的新内容 + 新的 offset + done 标志
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: taskId, stepId } = await params

  // AI: 解析 offset 参数（字节偏移量，用于增量读取）
  const offsetParam = req.nextUrl.searchParams.get('offset')
  const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0

  const logPath = path.join(DATA_DIR, 'tasks', taskId, 'steps', stepId, 'runner.log')

  try {
    // AI: 判断步骤是否已完成（done/failed = 不再有新内容）
    const exec = getExecution(taskId)
    const stepLog = exec?.steps.find((s) => s.stepId === stepId)
    const done = stepLog?.status === 'done' || stepLog?.status === 'failed' || stepLog?.status === 'skipped'

    // AI: 日志文件不存在时返回空内容（步骤可能还未开始写日志）
    if (!fs.existsSync(logPath)) {
      return NextResponse.json({ content: '', offset: 0, done })
    }

    const stat = fs.statSync(logPath)
    const fileSize = stat.size

    // AI: offset 超出文件大小时（如文件被截断），重置到 0
    const readOffset = offset > fileSize ? 0 : offset

    // AI: 读取 offset 之后的新内容（最多 64KB，防止单次返回过大）
    const MAX_READ = 64 * 1024
    let content = ''
    if (readOffset < fileSize) {
      const fd = fs.openSync(logPath, 'r')
      const readLen = Math.min(fileSize - readOffset, MAX_READ)
      const buf = Buffer.alloc(readLen)
      fs.readSync(fd, buf, 0, readLen, readOffset)
      fs.closeSync(fd)
      content = buf.toString('utf-8')
    }

    return NextResponse.json({
      content,
      offset: readOffset + content.length,
      done,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 步骤实时日志 API 结束 */
