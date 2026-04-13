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
  type: 'openclaw'
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
// AI: GET /api/agents/summary?name=<name>&pluginId=openclaw
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  const pluginId = req.nextUrl.searchParams.get('pluginId') ?? ''

  if (!name) return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })

  try {
    // AI: 只支持 openclaw
    const summary = buildOpenclawSummary(name)
    return NextResponse.json({ summary })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Agent Summary API 结束 */
