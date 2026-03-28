/*  start: Manta 托管 Agent 单个操作 — GET 读取 / PUT 更新 / DELETE 删除 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')

// AI: GET /api/agents/manta/[name] — 读取单个 Manta agent 详情（meta + SOUL.md）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const agentDir = path.join(MANTA_AGENTS_DIR, name)
  const metaPath = path.join(agentDir, 'agent.json')
  const soulPath = path.join(agentDir, 'SOUL.md')

  if (!fs.existsSync(metaPath)) {
    return NextResponse.json({ error: `Agent "${name}" 不存在` }, { status: 404 })
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : ''
    return NextResponse.json({ agent: { ...meta, soul } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: PUT /api/agents/manta/[name] — 更新 Manta agent（SOUL.md + meta）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const agentDir = path.join(MANTA_AGENTS_DIR, name)
  const metaPath = path.join(agentDir, 'agent.json')

  if (!fs.existsSync(metaPath)) {
    return NextResponse.json({ error: `Agent "${name}" 不存在` }, { status: 404 })
  }

  try {
    const body = await req.json()
    const { soul, description } = body

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const updated = {
      ...meta,
      description: description !== undefined ? description.trim() : meta.description,
      updatedAt: new Date().toISOString(),
    }

    // AI: 备份 SOUL.md 再写入
    const soulPath = path.join(agentDir, 'SOUL.md')
    if (soul !== undefined) {
      if (fs.existsSync(soulPath)) {
        fs.copyFileSync(soulPath, soulPath + '.bak')
      }
      fs.writeFileSync(soulPath, soul, 'utf-8')
    }
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8')

    return NextResponse.json({ agent: { ...updated, soul: soul ?? (fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : '') } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: DELETE /api/agents/manta/[name] — 删除 Manta agent（仅从 manta-data 删除，不影响 CLI）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  const agentDir = path.join(MANTA_AGENTS_DIR, name)

  if (!fs.existsSync(agentDir)) {
    return NextResponse.json({ error: `Agent "${name}" 不存在` }, { status: 404 })
  }

  try {
    fs.rmSync(agentDir, { recursive: true, force: true })
    return NextResponse.json({ success: true, name })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Manta Agent 单个操作结束 */
