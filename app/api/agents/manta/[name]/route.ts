/*  start: Manta Agent 单个操作 — GET 读取 / PUT 更新 / DELETE 删除 */
// AI: Core 层只通过 AgentOps 接口操作，CLI 特有逻辑在插件层
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAgentOps } from '@/plugins/loader'

const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')

interface AgentMeta {
  name: string
  targetCli: 'openclaw' | 'claude-code'
  description: string
  createdAt: string
  updatedAt: string
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

// AI: GET /api/agents/manta/[name] — 读取单个 agent（元数据 + 内容从 CLI 目录读取）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const meta = readMeta(name)

  if (!meta) {
    return NextResponse.json({ error: `Agent "${name}" 不在 Manta 管理列表中` }, { status: 404 })
  }

  // AI: 通过插件接口读取 CLI 原生目录中的内容
  const ops = getAgentOps(meta.targetCli)
  const soul = ops ? await ops.readAgentContent(meta.name) : null

  return NextResponse.json({ agent: { ...meta, soul } })
}

// AI: PUT /api/agents/manta/[name] — 更新 agent（通过插件接口写入 CLI 原生目录）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const meta = readMeta(name)

  if (!meta) {
    return NextResponse.json({ error: `Agent "${name}" 不在 Manta 管理列表中` }, { status: 404 })
  }

  try {
    const body = await req.json()
    const { soul, description } = body

    // AI: 通过插件接口更新 CLI 原生目录中的内容
    const ops = getAgentOps(meta.targetCli)
    if (!ops) {
      return NextResponse.json({ error: `不支持的 targetCli: ${meta.targetCli}` }, { status: 400 })
    }

    await ops.updateAgent(meta.name, {
      soul: soul !== undefined ? soul : undefined,
      description: description !== undefined ? description : undefined,
    })

    // AI: 更新 manta-data 中的元数据
    const updated: AgentMeta = {
      ...meta,
      description: description !== undefined ? description.trim() : meta.description,
      updatedAt: new Date().toISOString(),
    }
    const metaPath = path.join(MANTA_AGENTS_DIR, name, 'agent.json')
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8')

    // AI: 读取最新内容回传给前端
    const newSoul = await ops.readAgentContent(meta.name)
    return NextResponse.json({ agent: { ...updated, soul: newSoul ?? soul } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: DELETE /api/agents/manta/[name] — 删除 agent
// 默认只从 manta-data 删除元数据，可通过 ?removeCli=true 同时从 CLI 删除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const meta = readMeta(name)

  if (!meta) {
    return NextResponse.json({ error: `Agent "${name}" 不在 Manta 管理列表中` }, { status: 404 })
  }

  const removeCli = new URL(req.url).searchParams.get('removeCli') === 'true'

  try {
    // AI: 可选：从 CLI 原生目录删除
    if (removeCli) {
      const ops = getAgentOps(meta.targetCli)
      if (ops) {
        await ops.deleteAgent(meta.name)
      }
    }

    // AI: 从 manta-data 删除元数据目录
    const agentMetaDir = path.join(MANTA_AGENTS_DIR, name)
    if (fs.existsSync(agentMetaDir)) {
      fs.rmSync(agentMetaDir, { recursive: true, force: true })
    }

    return NextResponse.json({ success: true, name, removedFromCli: removeCli })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Manta Agent 单个操作结束 */
