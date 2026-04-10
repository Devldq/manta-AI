/*  start: Agent Summary API — 读取 agent 关键信息摘要（模型、能力、subagents 等） */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) return path.join(os.homedir(), rawDir.slice(2))
  return path.resolve(process.cwd(), rawDir)
}

// AI: 读取 models.json 内容（openclaw agent 私有模型）
function readModelsJson(agentDir: string): ModelsJson | null {
  const p = path.join(agentDir, 'models.json')
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

// AI: 读取 openclaw.json 全局配置
function readOpenclawConfig(): OpenclawConfig | null {
  const p = expandDir('~/.openclaw/openclaw.json')
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

// AI: 从 models.json 提取模型摘要
function extractModels(json: ModelsJson): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const [providerName, provider] of Object.entries(json.providers ?? {})) {
    for (const m of provider.models ?? []) {
      models.push({
        provider: providerName,
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        capabilities: m.input ?? [],
        reasoning: m.reasoning ?? false,
      })
    }
  }
  return models
}

// ─── 摘要构建 ───────────────────────────────────────────────

function buildOpenclawSummary(name: string): AgentSummary {
  const config = readOpenclawConfig()
  const agentEntry = config?.agents?.list?.find((a) => (a.name || a.id) === name)
  const agentDir = agentEntry?.agentDir

  // AI: 私有模型（agentDir/models.json）
  let models: ModelInfo[] = []
  if (agentDir) {
    const json = readModelsJson(agentDir)
    if (json) models = extractModels(json)
  }

  // AI: 如果没有私有模型，回退到全局默认模型
  const defaults = config?.agents?.defaults
  const defaultModelKey = defaults?.model?.primary ?? null
  const defaultModelAlias = defaultModelKey ? defaults?.models?.[defaultModelKey]?.alias ?? null : null

  // AI: 解析全局 providers 里的默认模型信息
  let defaultModelInfo: ModelInfo | null = null
  if (defaultModelKey && models.length === 0) {
    const [defaultProvider, defaultId] = defaultModelKey.split('/')
    const globalProviders = config?.models?.providers ?? {}
    const provider = globalProviders[defaultProvider]
    const m = provider?.models?.find((m: { id: string }) => m.id === defaultId)
    if (m) {
      defaultModelInfo = {
        provider: defaultProvider,
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        capabilities: m.input ?? [],
        reasoning: m.reasoning ?? false,
      }
    }
  }

  const subagents = agentEntry?.subagents?.allowAgents ?? []
  const workspace = agentEntry?.workspace ?? defaults?.workspace ?? null

  return {
    type: 'openclaw',
    name,
    models: models.length > 0 ? models : (defaultModelInfo ? [defaultModelInfo] : []),
    isUsingDefaultModel: models.length === 0,
    defaultModel: defaultModelAlias ?? defaultModelKey,
    subagents,
    workspace: workspace ?? undefined,
    extra: {},
  }
}

function buildClaudeSummary(name: string): AgentSummary {
  const filePath = expandDir(`~/.claude/agents/${name}.md`)
  if (!fs.existsSync(filePath)) {
    return { type: 'claude-code', name, models: [], isUsingDefaultModel: true, defaultModel: 'claude (系统默认)', subagents: [], extra: {} }
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = frontmatterMatch?.[1] ?? ''

  // AI: 解析 frontmatter 的 tools 字段（可能是逗号分隔或 YAML 列表）
  const toolsRaw = fm.match(/^tools:\s*(.+)$/m)?.[1]?.trim()
  let tools: string[] = []
  if (toolsRaw) {
    tools = toolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
  }

  const model = fm.match(/^model:\s*(.+)$/m)?.[1]?.trim() ?? null
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''

  return {
    type: 'claude-code',
    name,
    models: model ? [{ provider: 'anthropic', id: model, name: model, capabilities: [], reasoning: false }] : [],
    isUsingDefaultModel: !model,
    defaultModel: model ?? 'claude (系统默认)',
    subagents: [],
    extra: { tools, description },
  }
}

function buildCodeflickerSummary(name: string): AgentSummary {
  const skillMd = expandDir(`~/.codeflicker/internal/skills/${name}/SKILL.md`)
  if (!fs.existsSync(skillMd)) {
    return { type: 'codeflicker', name, models: [], isUsingDefaultModel: true, defaultModel: '系统默认', subagents: [], extra: {} }
  }
  const content = fs.readFileSync(skillMd, 'utf-8')
  const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const source = content.match(/^source:\s*(.+)$/m)?.[1]?.trim() ?? ''
  return {
    type: 'codeflicker',
    name,
    models: [],
    isUsingDefaultModel: true,
    defaultModel: 'CodeFlicker 内置',
    subagents: [],
    extra: { description, source },
  }
}

// ─── 类型定义 ───────────────────────────────────────────────
interface ModelInfo {
  provider: string
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  capabilities: string[]
  reasoning: boolean
}

interface AgentSummary {
  type: 'openclaw' | 'claude-code' | 'codeflicker'
  name: string
  models: ModelInfo[]
  isUsingDefaultModel: boolean
  defaultModel: string | null
  subagents: string[]
  workspace?: string
  extra: Record<string, unknown>
}

interface OpenclawAgentEntry {
  id?: string
  name?: string
  agentDir?: string
  workspace?: string
  subagents?: { allowAgents?: string[] }
}

interface OpenclawConfig {
  models?: {
    providers?: Record<string, {
      models?: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number; input?: string[]; reasoning?: boolean }>
    }>
  }
  agents?: {
    defaults?: {
      model?: { primary?: string }
      models?: Record<string, { alias?: string }>
      workspace?: string
    }
    list?: OpenclawAgentEntry[]
  }
}

interface ModelsJson {
  providers?: Record<string, {
    models?: Array<{
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
      input?: string[]
      reasoning?: boolean
    }>
  }>
}

// ─── Route Handler ───────────────────────────────────────────
// AI: GET /api/agents/summary?name=<name>&pluginId=<openclaw|claude-code|codeflicker>
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  const pluginId = req.nextUrl.searchParams.get('pluginId') ?? ''

  if (!name) return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })

  try {
    let summary: AgentSummary

    if (pluginId === 'openclaw') {
      summary = buildOpenclawSummary(name)
    } else if (pluginId === 'claude-code') {
      summary = buildClaudeSummary(name)
    } else if (pluginId === 'codeflicker') {
      summary = buildCodeflickerSummary(name)
    } else {
      // AI: 自动探测：先试 openclaw，再 claude-code，再 codeflicker
      const config = readOpenclawConfig()
      const inOpenclaw = config?.agents?.list?.some((a) => (a.name || a.id) === name)
      if (inOpenclaw) {
        summary = buildOpenclawSummary(name)
      } else if (fs.existsSync(expandDir(`~/.claude/agents/${name}.md`))) {
        summary = buildClaudeSummary(name)
      } else {
        summary = buildCodeflickerSummary(name)
      }
    }

    return NextResponse.json({ summary })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Agent Summary API 结束 */
