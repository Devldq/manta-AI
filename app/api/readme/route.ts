/* AI start: README API — GET /api/readme，读取项目根目录 README.md 内容 */
import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export async function GET() {
  try {
    const readmePath = join(process.cwd(), 'README.md')
    const content = await readFile(readmePath, 'utf-8')
    return NextResponse.json({ content })
  } catch {
    return NextResponse.json({ content: '# 暂无说明\n\nREADME.md 文件未找到。' })
  }
}
/* AI end: README API */
