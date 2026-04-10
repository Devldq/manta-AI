/* AI start: 新建工作流 API — POST /api/workflows/def
 * 接收工作流 ID + 初始 YAML 内容，写入 workflows/<id>.yaml 文件
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows')

export async function POST(req: NextRequest) {
  try {
    const { id, yaml } = await req.json()

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id 不能为空' }, { status: 400 })
    }

    // AI: 校验 id 只能包含字母、数字、连字符、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
      return NextResponse.json(
        { error: 'ID 只能包含字母、数字、连字符(-)和下划线(_)' },
        { status: 400 }
      )
    }

    const filePath = path.join(WORKFLOWS_DIR, `${id.trim()}.yaml`)

    // AI: 不允许覆盖已有文件
    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `工作流 "${id}" 已存在，请使用不同的 ID` },
        { status: 409 }
      )
    }

    if (!fs.existsSync(WORKFLOWS_DIR)) {
      fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
    }

    const content = typeof yaml === 'string' && yaml.trim()
      ? yaml
      : `name: ${id.trim()}\nid: ${id.trim()}\ndescription: ''\n\nsteps:\n  - id: step1\n    name: 第一步\n    agent: my-agent\n`

    fs.writeFileSync(filePath, content, 'utf-8')

    return NextResponse.json({ ok: true, id: id.trim(), filePath })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/* AI end: 新建工作流 API 结束 */
