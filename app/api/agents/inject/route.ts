/*  start: Agent 注入 API — POST /api/agents/inject */
// AI: 把 ~/manta-data/agents/ 下的 agent 注入到对应 CLI 工具目录
// openclaw: 更新 ~/.openclaw/openclaw.json + 创建 workspace-<name>/SOUL.md
// claude-code: 写入 ~/.claude/agents/<name>.md（YAML frontmatter + SOUL.md 正文）
import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json')
const CLAUDE_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents')

interface InjectResult {
  name: string
  targetCli: string
  status: 'injected' | 'updated' | 'skipped' | 'error'
  message?: string
}

// AI: 注入到 openclaw
function injectToOpenclaw(name: string, soul: string, description: string): InjectResult {
  try {
    // AI: 1. 创建/更新 workspace 目录和 SOUL.md
    const workspaceDir = path.join(os.homedir(), '.openclaw', `workspace-${name}`)
    if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })

    const soulTarget = path.join(workspaceDir, 'SOUL.md')
    const isNew = !fs.existsSync(soulTarget)

    // AI: 写前备份（若已存在）
    if (!isNew) fs.copyFileSync(soulTarget, soulTarget + `.bak.${Date.now()}`)
    fs.writeFileSync(soulTarget, soul, 'utf-8')

    // AI: 2. 更新 openclaw.json 的 agents.list
    if (!fs.existsSync(OPENCLAW_CONFIG)) {
      return { name, targetCli: 'openclaw', status: 'error', message: 'openclaw.json 不存在' }
    }

    // AI: 备份 openclaw.json 再修改
    fs.copyFileSync(OPENCLAW_CONFIG, OPENCLAW_CONFIG + `.bak.${Date.now()}`)
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'))
    const list: Array<{ id: string; name?: string; workspace?: string }> =
      config?.agents?.list ?? []

    const existingIdx = list.findIndex((a) => a.id === name)
    const entry = {
      id: name,
      name,
      workspace: workspaceDir,
    }

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...entry }
    } else {
      list.push(entry)
    }

    if (!config.agents) config.agents = {}
    config.agents.list = list
    fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8')

    return { name, targetCli: 'openclaw', status: isNew ? 'injected' : 'updated' }
  } catch (err) {
    return { name, targetCli: 'openclaw', status: 'error', message: String(err) }
  }
}

// AI: 注入到 claude-code（写 ~/.claude/agents/<name>.md）
function injectToClaudeCode(name: string, soul: string, description: string): InjectResult {
  try {
    if (!fs.existsSync(CLAUDE_AGENTS_DIR)) {
      fs.mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true })
    }

    const agentPath = path.join(CLAUDE_AGENTS_DIR, `${name}.md`)
    const isNew = !fs.existsSync(agentPath)

    // AI: 写前备份
    if (!isNew) fs.copyFileSync(agentPath, agentPath + `.bak.${Date.now()}`)

    // AI: claude sub-agent 格式：YAML frontmatter + 正文
    const content = `---\nname: ${name}\ndescription: ${description || name}\n---\n\n${soul}`
    fs.writeFileSync(agentPath, content, 'utf-8')

    return { name, targetCli: 'claude-code', status: isNew ? 'injected' : 'updated' }
  } catch (err) {
    return { name, targetCli: 'claude-code', status: 'error', message: String(err) }
  }
}

// AI: POST /api/agents/inject — 注入所有 Manta 托管 agent 到对应 CLI
export async function POST() {
  const results: InjectResult[] = []

  if (!fs.existsSync(MANTA_AGENTS_DIR)) {
    return NextResponse.json({ results: [], message: '暂无 Manta 托管 agent' })
  }

  for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(MANTA_AGENTS_DIR, entry.name, 'agent.json')
    const soulPath = path.join(MANTA_AGENTS_DIR, entry.name, 'SOUL.md')

    if (!fs.existsSync(metaPath)) continue

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : ''

      if (meta.targetCli === 'openclaw') {
        results.push(injectToOpenclaw(meta.name, soul, meta.description ?? ''))
      } else if (meta.targetCli === 'claude-code') {
        results.push(injectToClaudeCode(meta.name, soul, meta.description ?? ''))
      } else {
        results.push({ name: meta.name, targetCli: meta.targetCli, status: 'skipped', message: '不支持的 targetCli' })
      }
    } catch (err) {
      results.push({ name: entry.name, targetCli: 'unknown', status: 'error', message: String(err) })
    }
  }

  return NextResponse.json({ results })
}

// AI: GET /api/agents/inject — 查看注入状态（不执行注入）
export async function GET() {
  const status: Array<{ name: string; targetCli: string; injected: boolean }> = []

  if (!fs.existsSync(MANTA_AGENTS_DIR)) {
    return NextResponse.json({ status: [] })
  }

  for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(MANTA_AGENTS_DIR, entry.name, 'agent.json')
    if (!fs.existsSync(metaPath)) continue

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      let injected = false

      if (meta.targetCli === 'openclaw' && fs.existsSync(OPENCLAW_CONFIG)) {
        const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'))
        const list: Array<{ id: string }> = config?.agents?.list ?? []
        injected = list.some((a) => a.id === meta.name)
      } else if (meta.targetCli === 'claude-code') {
        injected = fs.existsSync(path.join(CLAUDE_AGENTS_DIR, `${meta.name}.md`))
      }

      status.push({ name: meta.name, targetCli: meta.targetCli, injected })
    } catch { /* skip */ }
  }

  return NextResponse.json({ status })
}
/*  end: Agent 注入 API 结束 */
