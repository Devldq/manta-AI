/* AI start: 插件 Loader — 启动时扫描 plugins/ 目录，加载各插件的 agents，合并到 Registry */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { AgentEntry, AgentOps, PluginManifest } from '../core/types'
import { openclawAgentOps } from './openclaw/agent-ops'
import { claudeCodeAgentOps } from './claude-code/agent-ops'

// AI: 插件根目录（项目内的 plugins/ 文件夹）
const PLUGINS_DIR = path.join(process.cwd(), 'plugins')

// AI: 展开 ~ 路径；相对路径基于 cwd 展开
function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) {
    return path.join(os.homedir(), rawDir.slice(2))
  }
  return path.resolve(process.cwd(), rawDir)
}

// AI: 解析 markdown 格式的 agent 文件（YAML frontmatter + 系统提示正文）
// claude-code sub-agents 使用此格式，每个 .md 文件对应一个 agent
function parseMarkdownAgent(
  filePath: string,
  pluginId: string,
  runnerId: string
): AgentEntry | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return null

    const frontmatter = yaml.load(match[1]) as Record<string, unknown>
    const name = (frontmatter.name as string) || path.basename(filePath, path.extname(filePath))
    const description = (frontmatter.description as string) || ''

    return {
      name,
      runnerId,
      description,
      enabled: true,
      source: 'plugin-native',
      pluginId,
      filePath,
      fileReadonly: false,
    }
  } catch {
    return null
  }
}

// AI: 解析 yaml 格式的 agent 文件，每个 .yaml/.yml 文件对应一个 agent
function parseYamlAgent(
  filePath: string,
  pluginId: string,
  runnerId: string
): AgentEntry | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(content) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null

    const name = (parsed.name as string) || path.basename(filePath, path.extname(filePath))
    const description = (parsed.description as string) || ''

    return {
      name,
      runnerId,
      description,
      enabled: true,
      source: 'plugin-native',
      pluginId,
      filePath,
      fileReadonly: false,
    }
  } catch {
    return null
  }
}

// AI: 解析 codeflicker-skill 格式，每个 skill 是一个子目录，入口文件为 SKILL.md
function parseCodeflickerSkillDir(
  skillDir: string,
  pluginId: string,
  runnerId: string
): AgentEntry | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    const skillDirName = path.basename(skillDir)

    let name = skillDirName
    let description = ''

    if (match) {
      try {
        const frontmatter = yaml.load(match[1]) as Record<string, unknown>
        name = (frontmatter.name as string) || skillDirName
        description = (frontmatter.description as string) || ''
      } catch {
        // AI: frontmatter 解析失败时，使用目录名作为 name
      }
    }

    return {
      name,
      runnerId,
      description,
      enabled: true,
      source: 'plugin-native',
      pluginId,
      filePath: skillMdPath,
      fileReadonly: false,
    }
  } catch {
    return null
  }
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

// AI: 加载单个插件的所有 agents（根据 agentFormat 选择不同解析策略）
function loadPluginAgents(manifest: PluginManifest): AgentEntry[] {
  // AI: openclaw-json 格式走独立分支，不依赖 agentsDirs
  if (manifest.agentFormat === 'openclaw-json') {
    return loadOpenclawJsonAgents(manifest)
  }

  const agents: AgentEntry[] = []

  for (const rawDir of (manifest.agentsDirs ?? [])) {
    const dir = expandDir(rawDir)
    if (!fs.existsSync(dir)) continue

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      let agentEntry: AgentEntry | null = null

      if (manifest.agentFormat === 'codeflicker-skill') {
        // AI: CodeFlicker skill 格式，每个子目录是一个 skill，入口是 SKILL.md
        if (entry.isDirectory()) {
          agentEntry = parseCodeflickerSkillDir(
            path.join(dir, entry.name),
            manifest.id,
            manifest.runnerId
          )
        }
      } else if (manifest.agentFormat === 'markdown') {
        // AI: claude-code 格式，每个 .md 文件是一个 agent
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (ext === '.md' || ext === '.mdx') {
            agentEntry = parseMarkdownAgent(
              path.join(dir, entry.name),
              manifest.id,
              manifest.runnerId
            )
          }
        }
      } else if (manifest.agentFormat === 'yaml') {
        // AI: yaml 文件格式，每个 .yaml/.yml 文件是一个 agent
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (ext === '.yaml' || ext === '.yml') {
            agentEntry = parseYamlAgent(
              path.join(dir, entry.name),
              manifest.id,
              manifest.runnerId
            )
          }
        }
      }

      if (agentEntry) {
        agents.push(agentEntry)
      }
    }
  }

  return agents
}

// AI: 读取 plugin.yaml
function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, 'plugin.yaml')
  if (!fs.existsSync(manifestPath)) return null

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const parsed = yaml.load(raw) as PluginManifest
    if (!parsed?.id || !parsed?.runnerId) return null
    return parsed
  } catch {
    return null
  }
}

// AI: 扫描所有插件目录，返回所有 plugin-native agents
export function loadAllPluginAgents(): AgentEntry[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const pluginDirs: string[] = []
  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
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

    const agents = loadPluginAgents(manifest)
    allAgents.push(...agents)
  }

  return allAgents
}

// AI: 列出所有已安装插件的 manifest
export function listPlugins(): PluginManifest[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const manifests: PluginManifest[] = []
  try {
    for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const manifest = readPluginManifest(path.join(PLUGINS_DIR, entry.name))
        if (manifest) manifests.push(manifest)
      }
    }
  } catch {
    return []
  }
  return manifests
}
/**
 * getAgentOps — Core 层通过此函数获取对应 CLI 插件的 AgentOps 实现
 * 插件层负责封装 CLI 特有操作，Core 只知道 AgentOps 接口
 *
 * @param pluginId - 插件 ID（对应 plugin.yaml 的 id 字段）
 * @returns AgentOps 实现，若插件不支持则返回 null
 */
export function getAgentOps(pluginId: string): AgentOps | null {
  switch (pluginId) {
    case 'openclaw':
      return openclawAgentOps
    case 'claude-code':
      return claudeCodeAgentOps
    default:
      return null
  }
}
/* AI end: 插件 Loader 结束 */
