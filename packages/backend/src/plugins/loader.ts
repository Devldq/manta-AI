/* AI start: 插件 Loader — 启动时扫描 plugins/ 目录，加载 openclaw 插件的 agents */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { AgentEntry, AgentOps, PluginManifest } from '../core/types'

// 使用 require() 同步加载，避免 tsx + Node 18 ESM named export 丢失 bug
function getOpenclawAgentOps(): AgentOps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./openclaw/agent-ops').openclawAgentOps as AgentOps
}

// AI: 插件根目录（项目内的 plugins/ 文件夹）
const PLUGINS_DIR = path.join(process.cwd(), 'plugins')
// AI: 内置插件目录名（openclaw）
const BUILTIN_PLUGIN_IDS = new Set(['openclaw'])
// AI: 插件禁用状态持久化文件（记录 disabled pluginId 列表）
const DISABLED_FILE = path.join(PLUGINS_DIR, '_disabled.json')

// AI: 读取禁用列表（供 API 层调用）
export function readDisabledSet(): Set<string> {
  try {
    if (!fs.existsSync(DISABLED_FILE)) return new Set()
    const raw = fs.readFileSync(DISABLED_FILE, 'utf-8')
    const list = JSON.parse(raw)
    return new Set(Array.isArray(list) ? list : [])
  } catch {
    return new Set()
  }
}

// AI: 写入禁用列表（供 API 层调用）
export function writeDisabledSet(ids: Set<string>): void {
  fs.writeFileSync(DISABLED_FILE, JSON.stringify([...ids], null, 2))
}

// AI: 展开 ~ 路径；相对路径基于 cwd 展开
function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) {
    return path.join(os.homedir(), rawDir.slice(2))
  }
  return path.resolve(process.cwd(), rawDir)
}

// AI: 解析 openclaw-json 格式，读 openclawConfigFile 指定的 JSON 文件中的 agents.list
// openclaw.json 结构: { agents: { list: [{ id, name, workspace, agentDir? }] } }
function loadOpenclawJsonAgents(manifest: PluginManifest): AgentEntry[] {
  const configPath = manifest.openclawConfigFile
  if (!configPath) return []

  const expanded = expandDir(configPath)
  if (!fs.existsSync(expanded)) return []

  try {
    const raw = fs.readFileSync(expanded, 'utf-8')
    const parsed = JSON.parse(raw)
    const list: Array<{ id?: string; name?: string; workspace?: string; agentDir?: string }> =
      parsed?.agents?.list ?? []

    return list
      .filter((a) => a.id)
      .map((a) => {
        // AI: agentDir 是具体 agent 目录（如 ~/.openclaw/agents/taizi/agent），models.json 含 API key，只读
        const filePath = a.agentDir ? path.join(a.agentDir, 'models.json') : undefined
        return {
          name: a.name || a.id!,
          runnerId: manifest.runnerId,
          description: a.workspace ? `workspace: ${a.workspace}` : undefined,
          enabled: true,
          source: 'plugin-native' as const,
          pluginId: manifest.id,
          filePath,
          fileReadonly: true, // AI: models.json 含 API key，只读展示
        }
      })
  } catch {
    return []
  }
}

// AI: 加载 openclaw 插件的所有 agents
function loadPluginAgents(manifest: PluginManifest): AgentEntry[] {
  // AI: openclaw-json 格式
  if (manifest.agentFormat === 'openclaw-json') {
    return loadOpenclawJsonAgents(manifest)
  }
  return []
}

// AI: 读取 plugin.yaml，并附带 isExternal 标志（非内置插件视为外部安装，允许卸载）
function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, 'plugin.yaml')
  if (!fs.existsSync(manifestPath)) return null

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const parsed = yaml.load(raw) as PluginManifest
    if (!parsed?.id || !parsed?.runnerId) return null

    // AI: 非内置插件视为外部安装（isNpm 字段复用为 isExternal 语义）
    parsed.isNpm = !BUILTIN_PLUGIN_IDS.has(parsed.id)

    return parsed
  } catch {
    return null
  }
}

// AI: 扫描所有插件目录，返回所有 plugin-native agents（跳过 _npm_packages 内部目录，跳过 disabled）
export function loadAllPluginAgents(): AgentEntry[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const disabledSet = readDisabledSet()
  const pluginDirs: string[] = []
  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '_npm_packages') {
        pluginDirs.push(path.join(PLUGINS_DIR, entry.name))
      }
    }
  } catch {
    return []
  }

  const allAgents: AgentEntry[] = []
  for (const pluginDir of pluginDirs) {
    const manifest = readPluginManifest(pluginDir)
    if (!manifest) continue
    // AI: disabled 的插件不加载其 agents
    if (disabledSet.has(manifest.id)) continue

    const agents = loadPluginAgents(manifest)
    allAgents.push(...agents)
  }

  return allAgents
}

// AI: 列出所有已安装插件的 manifest（跳过 _npm_packages 目录本身），附带 disabled 状态
export function listPlugins(): PluginManifest[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const disabledSet = readDisabledSet()
  const manifests: PluginManifest[] = []
  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.name === '_npm_packages') continue
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const manifest = readPluginManifest(path.join(PLUGINS_DIR, entry.name))
        if (manifest) {
          manifest.disabled = disabledSet.has(manifest.id)
          manifests.push(manifest)
        }
      }
    }
  } catch {
    return []
  }
  return manifests
}
/**
 * getAgentOps — Core 层通过此函数获取 openclaw 的 AgentOps 实现
 * 插件层负责封装 CLI 特有操作，Core 只知道 AgentOps 接口
 *
 * @param pluginId - 插件 ID（目前只支持 'openclaw'）
 * @returns AgentOps 实现，若插件不支持则返回 null
 */
export function getAgentOps(pluginId: string): AgentOps | null {
  if (pluginId === 'openclaw') {
    return getOpenclawAgentOps()
  }
  return null
}
/* AI end: 插件 Loader 结束 */
