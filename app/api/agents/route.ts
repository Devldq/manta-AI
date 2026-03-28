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
      fileReadonly: true,
    }))
  } catch { return [] }
}

// AI: 加载 markdown 格式 agents（claude-code sub-agents，每个 .md 文件是一个 agent）
function loadMarkdownAgents(dir: string, pluginId: string, runnerId: string) {
  const expanded = expandDir(dir)
  if (!fs.existsSync(expanded)) return []
  const results = []
  try {
    for (const entry of fs.readdirSync(expanded, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (ext !== '.md' && ext !== '.mdx') continue
      const filePath = path.join(expanded, entry.name)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const match = content.match(/^---\n([\s\S]*?)\n---/)
        const name = match
          ? (content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? path.basename(entry.name, ext))
          : path.basename(entry.name, ext)
        const description = match ? (content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '') : ''
        results.push({ name, runnerId, description, enabled: true, source: 'plugin-native', pluginId, filePath, fileReadonly: false })
      } catch { /* skip */ }
    }
  } catch { /* dir unreadable */ }
  return results
}

// AI: 加载 codeflicker-skill 格式 agents（每个子目录含 SKILL.md）
function loadSkillAgents(dir: string, pluginId: string, runnerId: string) {
  const expanded = expandDir(dir)
  if (!fs.existsSync(expanded)) return []
  const results = []
  try {
    for (const entry of fs.readdirSync(expanded, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(expanded, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? entry.name
        const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
        results.push({ name, runnerId, description, enabled: true, source: 'plugin-native', pluginId, filePath: skillMdPath, fileReadonly: false })
      } catch { /* skip */ }
    }
  } catch { /* dir unreadable */ }
  return results
}

// AI: 汇总所有插件的 agents
function loadAllAgents() {
  return [
    ...loadOpenclawAgents(),
    ...loadMarkdownAgents('~/.claude/agents', 'claude-code', 'claude-code'),
    ...loadSkillAgents('~/.codeflicker/internal/skills', 'codeflicker', 'codeflicker'),
  ]
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
