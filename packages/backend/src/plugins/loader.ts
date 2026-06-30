/* 插件 Loader — 扫描 plugins/ 目录，加载插件 agents */
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import type { AgentEntry, PluginManifest } from '../core/types'

// 插件根目录（项目内的 plugins/ 文件夹）
const PLUGINS_DIR = path.join(process.cwd(), 'plugins')
// 插件禁用状态持久化文件
const DISABLED_FILE = path.join(PLUGINS_DIR, '_disabled.json')

// 读取禁用列表
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

// 写入禁用列表
export function writeDisabledSet(ids: Set<string>): void {
  fs.writeFileSync(DISABLED_FILE, JSON.stringify([...ids], null, 2))
}

// 读取 plugin.yaml
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

// 扫描所有插件目录，返回所有 plugin-native agents
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
    if (disabledSet.has(manifest.id)) continue
    // 每个插件通过自己的 adapter 加载 agents
    // 当前无内置插件，agents 由应用注册表管理
  }

  return allAgents
}

// 列出所有已安装插件的 manifest
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
