/* AI start: AI要闻文章 [slug] GET API — 按日期+slug读取文章缓存 */
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(_req.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  const filePath = path.join(AI_NEWS_DIR, 'articles', date, `${slug}.json`)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return NextResponse.json(JSON.parse(content))
}
/* AI end: AI要闻文章 [slug] GET API */
