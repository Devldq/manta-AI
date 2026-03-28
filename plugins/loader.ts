/* AI start: 插件 Loader — 启动时扫描 plugins/ 目录，加载各插件的 agents，合并到 Registry */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { AgentEntry, PluginManifest } from '../core/types'

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
    }
  } catch {
    return null
  }
}

// AI: 解析 yaml 格式的 agent 文件（openclaw 使用此格式）
// 每个 .yaml/.yml 文件对应一个 agent
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
    }
  } catch {
    return null
  }
}

// AI: 解析 codeflicker-skill 格式（每个 skill 是一个子目录，入口文件为 SKILL.md）
// CodeFlicker Skills 存放在 ~/.codeflicker/skills/<skill-name>/SKILL.md
function parseCodeflickerSkillDir(
  skillDir: string,
  pluginId: string,
  runnerId: string
): AgentEntry | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    // AI: 解析 YAML frontmatter（--- ... ---）
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
    }
  } catch {
    return null
  }
}

// AI: 加载单个插件的所有 agents（根据 agentFormat 选择不同解析策略）
function loadPluginAgents(manifest: PluginManifest): AgentEntry[] {
  const agents: AgentEntry[] = []

  for (const rawDir of manifest.agentsDirs) {
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
        // AI: CodeFlicker skill 格式 — 每个子目录是一个 skill，入口是 SKILL.md
        if (entry.isDirectory()) {
          agentEntry = parseCodeflickerSkillDir(
            path.join(dir, entry.name),
            manifest.id,
            manifest.runnerId
          )
        }
      } else if (manifest.agentFormat === 'markdown') {
        // AI: claude-code 格式 — 每个 .md 文件是一个 agent
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
        // AI: openclaw 格式 — 每个 .yaml/.yml 文件是一个 agent
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
/* AI end: 插件 Loader 结束 */
