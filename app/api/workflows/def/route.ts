/* AI start: 新建工作流 API — POST /api/workflows/def
 * 接收工作流 ID + 初始 YAML 内容，写入用户工作流目录
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { isBuiltinWorkflow } from '@/core/workflow-engine/loader'

// AI: 用户工作流目录（保存在用户数据目录，可读写）
const DATA_DIR = path.join(os.homedir(), '.manta-data')
const USER_WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows')

// AI: 确保用户工作流目录存在
function ensureUserWorkflowsDir(): void {
  if (!fs.existsSync(USER_WORKFLOWS_DIR)) {
    fs.mkdirSync(USER_WORKFLOWS_DIR, { recursive: true })
  }
}

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

    // AI: 检查是否与内置工作流 ID 冲突
    if (isBuiltinWorkflow(id.trim())) {
      return NextResponse.json(
        { error: `工作流 "${id}" 是内置工作流，不能使用此 ID` },
        { status: 409 }
      )
    }

    const filePath = path.join(USER_WORKFLOWS_DIR, `${id.trim()}.yaml`)

    // AI: 不允许覆盖已有文件
    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `工作流 "${id}" 已存在，请使用不同的 ID` },
        { status: 409 }
      )
    }

    ensureUserWorkflowsDir()

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
