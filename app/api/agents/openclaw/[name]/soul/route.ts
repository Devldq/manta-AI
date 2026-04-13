/*  start: OpenClaw Agent SOUL.md 读写 API */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: 展开 ~ 路径
function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

// AI: 读取 openclaw.json 获取 agent workspace
function getAgentWorkspace(name: string): string | null {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(configPath)) return null

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; workspace?: string }> = config?.agents?.list ?? []
    const entry = list.find((a) => a.id === name)
    
    if (entry?.workspace) {
      return expandPath(entry.workspace)
    }
    // AI: 降级到默认路径
    return path.join(os.homedir(), '.openclaw', `workspace-${name}`)
  } catch {
    return null
  }
}

// AI: GET /api/agents/openclaw/[name]/soul — 读取 SOUL.md
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  
  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  try {
    const workspace = getAgentWorkspace(name)
    if (!workspace) {
      return NextResponse.json({ error: 'Agent 未找到' }, { status: 404 })
    }

    const soulPath = path.join(workspace, 'SOUL.md')
    if (!fs.existsSync(soulPath)) {
      return NextResponse.json({ error: 'SOUL.md 文件不存在' }, { status: 404 })
    }

    const soul = fs.readFileSync(soulPath, 'utf-8')
    return NextResponse.json({ soul })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// AI: PUT /api/agents/openclaw/[name]/soul — 更新 SOUL.md
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  
  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  try {
    const body = await req.json()
    const { soul } = body

    if (typeof soul !== 'string') {
      return NextResponse.json({ error: 'soul 必须是字符串' }, { status: 400 })
    }

    const workspace = getAgentWorkspace(name)
    if (!workspace) {
      return NextResponse.json({ error: 'Agent 未找到' }, { status: 404 })
    }

    const soulPath = path.join(workspace, 'SOUL.md')
    
    // AI: 备份旧文件（如果存在）
    if (fs.existsSync(soulPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupPath = `${soulPath}.bak.${timestamp}`
      fs.copyFileSync(soulPath, backupPath)
    }

    // AI: 确保 workspace 目录存在
    fs.mkdirSync(workspace, { recursive: true })

    // AI: 写入新内容
    fs.writeFileSync(soulPath, soul, 'utf-8')

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: OpenClaw Agent SOUL.md 读写 API 结束 */
