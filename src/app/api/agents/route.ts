/*  start: Agent Registry API — GET /api/agents（只读，agent 定义权在各 CLI 工具）*/
// AI: 直接在 API route 里内联 loader 逻辑，避免 webpack 打包本地 fs/path 模块
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: 展开 ~ 路径
function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) return path.join(os.homedir(), rawDir.slice(2))
  return path.resolve(process.cwd(), rawDir)
}

// AI: 加载 openclaw agents（读 ~/.openclaw/openclaw.json agents.list）
function loadOpenclawAgents() {
  const configPath = expandDir('~/.openclaw/openclaw.json')
  if (!fs.existsSync(configPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; name?: string; workspace?: string; agentDir?: string }> =
      parsed?.agents?.list ?? []
    return list.filter((a) => a.id).map((a) => ({
      name: a.name || a.id!,
      runnerId: 'openclaw',
      description: a.workspace ? `workspace: ${a.workspace}` : undefined,
      enabled: true,
      source: 'plugin-native',
      pluginId: 'openclaw',
      filePath: a.agentDir ? path.join(a.agentDir, 'models.json') : undefined,
      fileReadonly: true,  // AI: models.json 只读（含 API key）
      soulEditable: true,  // AI: SOUL.md 可编辑
    }))
  } catch { return [] }
}

// AI: 汇总所有插件的 agents
function loadAllAgents() {
  return loadOpenclawAgents()
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const enabledOnly = searchParams.get('enabled') === 'true'
    const agents = loadAllAgents()
    const result = enabledOnly ? agents.filter((a) => a.enabled) : agents
    return NextResponse.json({ agents: result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Agent Registry API 结束 */
