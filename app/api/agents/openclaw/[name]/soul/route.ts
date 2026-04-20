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

// AI: 读取 openclaw.json 获取 agent 目录信息
function getAgentDirs(name: string): { workspace?: string; agentDir?: string } | null {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(configPath)) return null

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; workspace?: string; agentDir?: string }> = config?.agents?.list ?? []
    const entry = list.find((a) => a.id === name)
    
    if (!entry) return null
    
    const result: { workspace?: string; agentDir?: string } = {}
    
    if (entry.workspace) {
      result.workspace = expandPath(entry.workspace)
    } else {
      // 降级到默认 workspace 路径
      result.workspace = path.join(os.homedir(), '.openclaw', `workspace-${name}`)
    }
    
    if (entry.agentDir) {
      result.agentDir = expandPath(entry.agentDir)
    }
    
    return result
  } catch {
    return null
  }
}

// AI: 查找 SOUL.md 的实际路径（优先 agentDir，其次 workspace）
function findSoulPath(name: string): string | null {
  const dirs = getAgentDirs(name)
  if (!dirs) return null

  // 优先检查 agentDir/SOUL.md（OpenClaw 的标准位置）
  if (dirs.agentDir) {
    const agentDirSoul = path.join(dirs.agentDir, 'SOUL.md')
    if (fs.existsSync(agentDirSoul)) {
      return agentDirSoul
    }
  }

  // 其次检查 workspace/SOUL.md（兼容旧位置）
  if (dirs.workspace) {
    const workspaceSoul = path.join(dirs.workspace, 'SOUL.md')
    if (fs.existsSync(workspaceSoul)) {
      return workspaceSoul
    }
  }

  // 最后尝试默认 agent 路径：~/.openclaw/agents/{name}/SOUL.md
  const defaultAgentPath = path.join(os.homedir(), '.openclaw', 'agents', name, 'SOUL.md')
  if (fs.existsSync(defaultAgentPath)) {
    return defaultAgentPath
  }

  return null
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
    const soulPath = findSoulPath(name)
    if (!soulPath) {
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

    // AI: 查找 SOUL.md 路径
    let soulPath = findSoulPath(name)
    
    // 如果文件不存在，使用默认路径
    if (!soulPath) {
      const dirs = getAgentDirs(name)
      if (!dirs) {
        return NextResponse.json({ error: 'Agent 未找到' }, { status: 404 })
      }
      // 优先使用 agentDir，否则使用 workspace
      const baseDir = dirs.agentDir || dirs.workspace || path.join(os.homedir(), '.openclaw', 'agents', name)
      soulPath = path.join(baseDir, 'SOUL.md')
    }
    
    // AI: 备份旧文件（如果存在）
    if (fs.existsSync(soulPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupPath = `${soulPath}.bak.${timestamp}`
      fs.copyFileSync(soulPath, backupPath)
    }

    // AI: 确保目录存在
    fs.mkdirSync(path.dirname(soulPath), { recursive: true })

    // AI: 写入新内容
    fs.writeFileSync(soulPath, soul, 'utf-8')

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: OpenClaw Agent SOUL.md 读写 API 结束 */
