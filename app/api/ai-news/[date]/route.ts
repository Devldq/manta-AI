/* AI start: AI要闻 [date] API — GET 读取指定日期的摘要文件内容 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const AI_NEWS_DIR = path.join(
  process.env.ARM_DATA_ROOT
    ? path.resolve(process.env.ARM_DATA_ROOT.replace('~', os.homedir()))
    : path.join(os.homedir(), 'arm-data'),
  'ai-news'
)

// AI: GET /api/ai-news/[date] — 返回指定日期的 markdown 原文
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  // AI: 简单验证 date 格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  const filePath = path.join(AI_NEWS_DIR, `${date}.md`)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return NextResponse.json({ date, content })
}
/* AI end: AI要闻 [date] API */
