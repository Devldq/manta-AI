/*  start: Manta 托管 Agent CRUD — GET 列表 / POST 创建 */
// AI: Manta 是 agent 的 source of truth，定义存在 ~/manta-data/agents/<name>/
//     启动时自动注入到各 CLI 工具目录，方便备份和迁移
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')

// AI: 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// AI: 读取单个 Manta agent 的元数据
function readMantaAgent(name: string) {
  const agentDir = path.join(MANTA_AGENTS_DIR, name)
  const metaPath = path.join(agentDir, 'agent.json')
  const soulPath = path.join(agentDir, 'SOUL.md')

  if (!fs.existsSync(metaPath)) return null

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : ''
    return { ...meta, soul, agentDir }
  } catch {
    return null
  }
}

// AI: GET /api/agents/manta — 列出所有 Manta 托管 agent
export async function GET() {
  try {
    ensureDir(MANTA_AGENTS_DIR)
    const agents = []

    for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const agent = readMantaAgent(entry.name)
      if (agent) agents.push(agent)
    }

    return NextResponse.json({ agents })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: POST /api/agents/manta — 创建新的 Manta 托管 agent
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, targetCli, description, soul } = body

    // AI: 校验字段
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name 不能为空' }, { status: 400 })
    }
    if (!targetCli || !['openclaw', 'claude-code'].includes(targetCli)) {
      return NextResponse.json({ error: 'targetCli 必须是 openclaw 或 claude-code' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
      return NextResponse.json({ error: 'name 只能包含字母、数字、连字符和下划线' }, { status: 400 })
    }

    const agentName = name.trim()
    const agentDir = path.join(MANTA_AGENTS_DIR, agentName)

    if (fs.existsSync(agentDir)) {
      return NextResponse.json({ error: `Agent "${agentName}" 已存在` }, { status: 409 })
    }

    // AI: 创建目录和文件
    ensureDir(agentDir)

    const now = new Date().toISOString()
    const meta = {
      name: agentName,
      targetCli,
      description: description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    }

    fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(meta, null, 2), 'utf-8')
    fs.writeFileSync(path.join(agentDir, 'SOUL.md'), soul ?? `# ${agentName} Agent · SOUL\n\n你是一个 AI Agent。\n`, 'utf-8')

    return NextResponse.json({ agent: { ...meta, soul: soul ?? '' } }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Manta Agent CRUD 结束 */
