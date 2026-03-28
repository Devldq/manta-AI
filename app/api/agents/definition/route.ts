/*  start: Agent 定义文件读写 API — GET 读取内容 / PUT 保存修改 */
// AI: 直接内联 Node fs 操作，不通过 @/registry（避免 webpack 打包破坏 Node 模块）
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: 展开 ~ 路径
function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) return path.join(os.homedir(), rawDir.slice(2))
  return path.resolve(process.cwd(), rawDir)
}

// AI: 重建 agent 的 filePath 信息（不依赖 registry，直接从配置扫描）
function findAgentFilePath(name: string): { filePath: string | null; readonly: boolean } {
  // 1. openclaw agents — 从 openclaw.json 查找 agentDir
  try {
    const configPath = expandDir('~/.openclaw/openclaw.json')
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const list: Array<{ id?: string; name?: string; agentDir?: string }> =
        parsed?.agents?.list ?? []
      const found = list.find((a) => (a.name || a.id) === name)
      if (found) {
        const filePath = found.agentDir ? path.join(found.agentDir, 'models.json') : null
        return { filePath, readonly: true }
      }
    }
  } catch { /* ignore */ }

  // 2. claude-code agents — ~/.claude/agents/<name>.md
  const claudeAgentPath = expandDir(`~/.claude/agents/${name}.md`)
  if (fs.existsSync(claudeAgentPath)) {
    return { filePath: claudeAgentPath, readonly: false }
  }

  // 3. codeflicker skills — ~/.codeflicker/internal/skills/<name>/SKILL.md
  const skillMdPath = expandDir(`~/.codeflicker/internal/skills/${name}/SKILL.md`)
  if (fs.existsSync(skillMdPath)) {
    return { filePath: skillMdPath, readonly: false }
  }

  return { filePath: null, readonly: false }
}

// AI: GET /api/agents/definition?name=<agentName> — 读取 agent 定义文件内容
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  const { filePath, readonly } = findAgentFilePath(name)

  if (!filePath) {
    return NextResponse.json({
      name,
      content: null,
      filePath: null,
      readonly: true,
      message: '该 Agent 无可查看的定义文件',
    })
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json({ name, content, filePath, readonly })
  } catch (err) {
    return NextResponse.json({ error: `读取文件失败: ${String(err)}` }, { status: 500 })
  }
}

// AI: PUT /api/agents/definition — 保存修改后的 agent 定义文件
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { name, content } = body

  if (!name || content === undefined) {
    return NextResponse.json({ error: '缺少 name 或 content 参数' }, { status: 400 })
  }

  const { filePath, readonly } = findAgentFilePath(name)

  if (readonly) {
    return NextResponse.json({ error: '该 Agent 定义文件为只读，无法修改' }, { status: 403 })
  }

  if (!filePath) {
    return NextResponse.json({ error: '该 Agent 无定义文件路径' }, { status: 404 })
  }

  try {
    // AI: 写前先备份 .bak
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak')
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return NextResponse.json({ success: true, filePath })
  } catch (err) {
    return NextResponse.json({ error: `写入文件失败: ${String(err)}` }, { status: 500 })
  }
}
/*  end: Agent 定义文件读写 API 结束 */
