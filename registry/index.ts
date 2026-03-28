/*  start: Agent Registry — 名字 → CLI配置 + Skills 的注册表，支持插件扫描来源 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { AgentEntry } from '../core/types'
import { loadAllPluginAgents } from '../plugins/loader'

const REGISTRY_DIR = path.join(os.homedir(), 'arm-data', 'registry')
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'agents.yaml')

// AI: 默认内置三大插件的网关 Agent — Manta 初始化时开箱即用
// 插件目录扫描到的具体 agent（architect/dev/qa 等）会自动合并进来
const DEFAULT_AGENTS: AgentEntry[] = [
  {
    name: 'openclaw',
    runnerId: 'openclaw',
    bin: 'openclaw',
    skills: [],
    description: 'OpenClaw 默认会话 — 通过 openclaw CLI 执行任务',
    enabled: true,
    source: 'manta-custom',
  },
  {
    name: 'claude',
    runnerId: 'claude-code',
    bin: 'claude',
    skills: [],
    description: 'Claude Code 默认会话 — 直接调用 claude CLI',
    enabled: true,
    source: 'manta-custom',
  },
  {
    name: 'codeflicker',
    runnerId: 'codeflicker',
    bin: 'cf',
    skills: [],
    description: 'CodeFlicker 默认会话 — 通过 cf CLI 执行任务',
    enabled: true,
    source: 'manta-custom',
  },
]

// AI: 确保注册表目录和文件存在
function ensureRegistryFile(): void {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  }
  if (!fs.existsSync(REGISTRY_FILE)) {
    const content = yaml.dump({ agents: DEFAULT_AGENTS }, { indent: 2 })
    fs.writeFileSync(REGISTRY_FILE, content, 'utf-8')
  }
}

// AI: 只读取用户手动配置的 manta-custom agents（从 YAML 文件）
function loadCustomAgents(): AgentEntry[] {
  ensureRegistryFile()
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8')
    const parsed = yaml.load(raw) as { agents: AgentEntry[] }
    const agents = parsed?.agents ?? []
    // AI: 兼容旧格式：补充 source 字段
    return agents.map((a) => ({ ...a, source: a.source ?? 'manta-custom' }))
  } catch {
    return DEFAULT_AGENTS
  }
}

// AI: 读取所有 Agent（插件扫描 + 用户自定义，合并去重）
// plugin-native 优先；manta-custom 同名覆盖则 manta-custom 胜出（用户显式配置优先）
export function loadAgents(): AgentEntry[] {
  const pluginAgents = loadAllPluginAgents()
  const customAgents = loadCustomAgents()

  // AI: 以 name 为 key 合并，manta-custom 覆盖同名 plugin-native
  const map = new Map<string, AgentEntry>()
  for (const a of pluginAgents) {
    map.set(a.name, a)
  }
  for (const a of customAgents) {
    map.set(a.name, a) // custom 覆盖 plugin-native
  }

  return Array.from(map.values())
}

// AI: 根据名字查找 Agent（仅查启用的）
export function findAgent(name: string): AgentEntry | null {
  const agents = loadAgents()
  return agents.find((a) => a.name === name && a.enabled) ?? null
}

// AI: 注册 / 更新用户自定义 Agent（只写入 manta-custom YAML 文件）
export function registerAgent(entry: AgentEntry): void {
  ensureRegistryFile()
  const agents = loadCustomAgents()
  const existing = agents.findIndex((a) => a.name === entry.name)
  const toSave: AgentEntry = { ...entry, source: 'manta-custom' }
  if (existing >= 0) {
    agents[existing] = toSave
  } else {
    agents.push(toSave)
  }
  const content = yaml.dump({ agents }, { indent: 2 })
  fs.writeFileSync(REGISTRY_FILE, content, 'utf-8')
}

// AI: 删除用户自定义 Agent
export function unregisterAgent(name: string): void {
  ensureRegistryFile()
  const agents = loadCustomAgents().filter((a) => a.name !== name)
  const content = yaml.dump({ agents }, { indent: 2 })
  fs.writeFileSync(REGISTRY_FILE, content, 'utf-8')
}

// AI: 列出启用的 Agents
export function listEnabledAgents(): AgentEntry[] {
  return loadAgents().filter((a) => a.enabled)
}
/*  end: Agent Registry 结束 */
