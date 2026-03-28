/*  start: Manta Agent 管理 API — GET 列表 / POST 创建 */
// AI: Core 层只知道 AgentOps 接口，不含任何 CLI 特有操作
// CLI 特有的文件操作全部封装在对应插件的 agent-ops.ts 里
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAgentOps } from '@/plugins/loader'

// AI: Manta 元数据存储目录（只存 agent.json 元数据，不存内容）
const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')

interface AgentMeta {
  name: string
  targetCli: 'openclaw' | 'claude-code'
  description: string
  createdAt: string
  updatedAt: string
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readMeta(name: string): AgentMeta | null {
  const metaPath = path.join(MANTA_AGENTS_DIR, name, 'agent.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

// AI: GET /api/agents/manta — 列出所有 Manta 管理的 agent（元数据 + 内容从 CLI 目录读取）
export async function GET() {
  try {
    ensureDir(MANTA_AGENTS_DIR)
    const agents = []

    for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const meta = readMeta(entry.name)
      if (!meta) continue

      // AI: 通过插件接口读取 agent 内容（从 CLI 原生目录读取）
      const ops = getAgentOps(meta.targetCli)
      const soul = ops ? await ops.readAgentContent(meta.name) : null

      agents.push({ ...meta, soul })
    }

    return NextResponse.json({ agents })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: POST /api/agents/manta — 创建 agent（通过对应 CLI 插件创建，并在 manta-data 存元数据）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, targetCli, description, soul } = body

    // AI: 参数校验
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

    // AI: 检查 manta-data 中是否已存在（防止重复创建）
    const agentMetaDir = path.join(MANTA_AGENTS_DIR, agentName)
    if (fs.existsSync(agentMetaDir)) {
      return NextResponse.json({ error: `Agent "${agentName}" 已存在` }, { status: 409 })
    }

    // AI: 通过插件接口在 CLI 原生目录创建 agent
    const ops = getAgentOps(targetCli)
    if (!ops) {
      return NextResponse.json({ error: `不支持的 targetCli: ${targetCli}` }, { status: 400 })
    }

    await ops.createAgent({
      name: agentName,
      soul: soul ?? `# ${agentName} Agent · SOUL\n\n你是一个 AI Agent。\n`,
      description: description?.trim() ?? '',
    })

    // AI: 在 manta-data 存储元数据（方便知道哪些 agent 是 Manta 管理的）
    const now = new Date().toISOString()
    const meta: AgentMeta = {
      name: agentName,
      targetCli,
      description: description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    }

    ensureDir(agentMetaDir)
    fs.writeFileSync(path.join(agentMetaDir, 'agent.json'), JSON.stringify(meta, null, 2), 'utf-8')

    return NextResponse.json({ agent: { ...meta, soul: soul ?? '' } }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Manta Agent CRUD 结束 */
