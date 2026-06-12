/* 会话日志文件增量读取 API — GET /api/logs/file?offset=0&conversationId=xxx */

import { NextRequest, NextResponse } from 'next/server'
import { LogManager, LogEntry } from '@observability/log'
import * as fs from 'fs'

/** 获取日志文件路径（全局或会话专属） */
function getLogFilePath(conversationId?: string | null): string {
  if (conversationId) {
    return LogManager.getSessionLogFilePath(conversationId)
  }
  return LogManager.getLogFilePath()
}

/** GET /api/logs/file — 从日志文件增量读取日志条目 */
export async function GET(req: NextRequest) {
  const offsetParam = req.nextUrl.searchParams.get('offset')
  const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0
  const conversationId = req.nextUrl.searchParams.get('conversationId')

  const logFile = getLogFilePath(conversationId)
  if (!logFile) {
    return NextResponse.json({ entries: [], offset: 0 })
  }

  try {
    // 文件不存在时返回空（首次加载，还没写过日志）
    if (!fs.existsSync(logFile)) {
      return NextResponse.json({ entries: [], offset: 0 })
    }

    const stat = fs.statSync(logFile)
    const fileSize = stat.size

    // offset 超出文件大小时（如文件被 truncate），重置
    const readOffset = offset > fileSize ? 0 : offset

    if (readOffset >= fileSize) {
      return NextResponse.json({ entries: [], offset: readOffset })
    }

    // 增量读取（最多 128KB）
    const MAX_READ = 128 * 1024
    const readLen = Math.min(fileSize - readOffset, MAX_READ)
    const buf = Buffer.alloc(readLen)
    const fd = fs.openSync(logFile, 'r')
    fs.readSync(fd, buf, 0, readLen, readOffset)
    fs.closeSync(fd)

    const content = buf.toString('utf-8')

    // 按行解析 JSON（NDJSON 格式：每行一个 JSON 对象）
    const lines = content.split('\n').filter(line => line.trim())
    const entries: LogEntry[] = []
    let bytesConsumed = 0

    for (const line of lines) {
      bytesConsumed += Buffer.byteLength(line, 'utf-8') + 1 // +1 for newline
      try {
        const entry = JSON.parse(line) as LogEntry
        entries.push(entry)
      } catch {
        // 跳过无法解析的行（如截断行、非 JSON 行）
      }
    }

    const nextOffset = readOffset + bytesConsumed

    return NextResponse.json({ entries, offset: nextOffset })
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}
