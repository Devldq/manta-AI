/**
 * Plugin 文件扫描器 — 解析项目 plugins/ 目录中的 plugin.yaml 文件
 *
 * 支持解析完整的 plugin.yaml 清单，包括能力声明、钩子、依赖、权限等
 */

import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'
import type {
  PluginManifest,
  PluginCapability,
  PluginHook,
  PluginDependency,
  PluginPermission,
} from '@manta/shared'

// ─── 解析结果类型 ────────────────────────────────────────────

export interface ScannedPlugin {
  /** 清单数据 */
  manifest: PluginManifest
  /** 插件目录名 */
  dirName: string
  /** 插件在磁盘上的完整路径 */
  dirPath: string
}

// ─── YAML 解析 ───────────────────────────────────────────────

/** 解析 plugin.yaml 文件 */
function parsePluginYaml(filePath: string): PluginManifest | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.load(raw) as Record<string, unknown>
    if (!parsed || !parsed.id || !parsed.name) return null

    return parseManifest(parsed)
  } catch {
    return null
  }
}

/** 从 YAML 解析结果构造 PluginManifest */
function parseManifest(raw: Record<string, unknown>): PluginManifest {
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: typeof raw.version === 'string' ? raw.version : '1.0.0',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    author: typeof raw.author === 'string' ? raw.author : undefined,
    license: typeof raw.license === 'string' ? raw.license : undefined,
    homepage: typeof raw.homepage === 'string' ? raw.homepage : undefined,
    requires: typeof raw.requires === 'string' ? raw.requires : undefined,
    runnerId: typeof raw.runnerId === 'string' ? raw.runnerId : undefined,
    agentsDirs: Array.isArray(raw.agentsDirs)
      ? raw.agentsDirs.map(String)
      : undefined,
    agentFormat: typeof raw.agentFormat === 'string' ? raw.agentFormat : undefined,
    capabilities: parseCapabilities(raw.capabilities),
    hooks: parseHooks(raw.hooks),
    dependencies: parseDependencies(raw.dependencies),
    permissions: parsePermissions(raw.permissions),
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
  }
}

function parseCapabilities(raw: unknown): PluginCapability[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: PluginCapability[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    if (!c.type || !c.name) continue
    result.push({
      type: String(c.type) as PluginCapability['type'],
      name: String(c.name),
      description: typeof c.description === 'string' ? c.description : undefined,
      entry: typeof c.entry === 'string' ? c.entry : undefined,
      config: typeof c.config === 'object' && c.config !== null
        ? c.config as Record<string, unknown>
        : undefined,
    })
  }
  return result.length > 0 ? result : undefined
}

function parseHooks(raw: unknown): PluginHook[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: PluginHook[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const h = item as Record<string, unknown>
    if (!h.name || !h.event || !h.command) continue
    result.push({
      name: String(h.name),
      event: String(h.event) as PluginHook['event'],
      command: String(h.command),
      timeout: typeof h.timeout === 'number' ? h.timeout : undefined,
      blocking: typeof h.blocking === 'boolean' ? h.blocking : undefined,
    })
  }
  return result.length > 0 ? result : undefined
}

function parseDependencies(raw: unknown): PluginDependency[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: PluginDependency[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      result.push({ pluginId: item, required: true })
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const d = item as Record<string, unknown>
    if (!d.pluginId) continue
    result.push({
      pluginId: String(d.pluginId),
      version: typeof d.version === 'string' ? d.version : undefined,
      required: d.required !== false,
    })
  }
  return result.length > 0 ? result : undefined
}

function parsePermissions(raw: unknown): PluginPermission[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: PluginPermission[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      // 简单格式: "network.outbound" 或 "filesystem.read:path"
      const parts = item.split(':')
      const scope = parts[0] || ''
      const type = scope.split('.')[0] as PluginPermission['type']
      const action = parts[1] as PluginPermission['action'] | undefined
      result.push({ type: type || 'network', scope, action })
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const p = item as Record<string, unknown>
    if (!p.type || !p.scope) continue
    result.push({
      type: String(p.type) as PluginPermission['type'],
      scope: String(p.scope),
      action: typeof p.action === 'string' ? p.action as PluginPermission['action'] : undefined,
    })
  }
  return result.length > 0 ? result : undefined
}

// ─── 目录扫描 ────────────────────────────────────────────────

/**
 * 获取插件源目录基础路径
 */
export function getPluginsBaseDir(workspaceRoot?: string): string {
  const root = workspaceRoot || process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, 'plugins')
}

/**
 * 扫描 plugins/ 目录，找到所有 plugin.yaml 文件
 * 支持两种结构：
 *   plugins/{name}/plugin.yaml          — 标准结构
 *   plugins/{namespace}/{name}/plugin.yaml — 嵌套命名空间结构
 */
function findPluginFiles(rootDir: string): Array<{ filePath: string; dirName: string; dirPath: string }> {
  const results: Array<{ filePath: string; dirName: string; dirPath: string }> = []
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue

      const pluginYamlPath = path.join(rootDir, entry.name, 'plugin.yaml')
      const dirPath = path.join(rootDir, entry.name)

      if (fs.existsSync(pluginYamlPath)) {
        // 标准结构：{name}/plugin.yaml
        results.push({ filePath: pluginYamlPath, dirName: entry.name, dirPath })
      } else {
        // 尝试嵌套结构：{namespace}/{name}/plugin.yaml
        try {
          const subEntries = fs.readdirSync(dirPath, { withFileTypes: true })
          for (const sub of subEntries) {
            if (!sub.isDirectory() || sub.name.startsWith('.')) continue
            const subYamlPath = path.join(dirPath, sub.name, 'plugin.yaml')
            if (fs.existsSync(subYamlPath)) {
              results.push({
                filePath: subYamlPath,
                dirName: `${entry.name}/${sub.name}`,
                dirPath: path.join(dirPath, sub.name),
              })
            }
          }
        } catch {
          // 子目录读取失败，跳过
        }
      }
    }
  } catch {
    // 目录不存在或读取失败
  }
  return results
}

// ─── 公开接口 ────────────────────────────────────────────────

/**
 * 扫描所有 plugin.yaml 文件并返回解析结果
 */
export function scanPluginFiles(baseDir?: string): ScannedPlugin[] {
  const dir = baseDir || getPluginsBaseDir()

  if (!fs.existsSync(dir)) return []

  const files = findPluginFiles(dir)

  return files
    .map((f) => {
      const manifest = parsePluginYaml(f.filePath)
      if (!manifest) return null
      return {
        manifest,
        dirName: f.dirName,
        dirPath: f.dirPath,
      }
    })
    .filter((s): s is ScannedPlugin => s !== null)
}

/**
 * 扫描并打印所有找到的 Plugin（调试用）
 */
export function listScannedPluginNames(baseDir?: string): string[] {
  return scanPluginFiles(baseDir).map((s) => s.manifest.id)
}

/**
 * 读取指定 Plugin 的原始 plugin.yaml 内容
 */
export function readPluginYamlContent(name: string, baseDir?: string): string | null {
  const dir = baseDir || getPluginsBaseDir()
  const filePath = path.join(dir, name, 'plugin.yaml')
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 复制插件目录到 plugins/ 目标目录
 */
export function copyPluginDir(srcDir: string, destDir: string): void {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      // 跳过 node_modules 和 .git
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      copyPluginDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 验证 Plugin 清单是否合法
 */
export function validatePluginManifest(manifest: PluginManifest): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!manifest.id || !/^[a-z][a-z0-9-.]*$/.test(manifest.id)) {
    errors.push('插件 ID 必须以小写字母开头，仅包含小写字母、数字、连字符和点号')
  }
  if (!manifest.name || manifest.name.length > 64) {
    errors.push('插件名称不能为空且不超过 64 个字符')
  }
  if (!manifest.version) {
    errors.push('版本号不能为空')
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('版本号必须符合 semver 格式 (如 1.0.0)')
  }

  // 验证依赖
  if (manifest.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!dep.pluginId) {
        errors.push(`依赖声明缺少 pluginId`)
      }
      if (dep.version && !/^[><=^~]/.test(dep.version) && !/^\d/.test(dep.version)) {
        errors.push(`依赖 "${dep.pluginId}" 的版本约束格式无效: ${dep.version}`)
      }
    }
  }

  // 验证钩子
  if (manifest.hooks) {
    const validEvents = [
      'pre-install', 'post-install',
      'pre-uninstall', 'post-uninstall',
      'on-enable', 'on-disable', 'on-upgrade',
      'pre-agent-run', 'post-agent-run',
    ]
    for (const hook of manifest.hooks) {
      if (!validEvents.includes(hook.event)) {
        errors.push(`钩子 "${hook.name}" 的事件类型无效: ${hook.event}`)
      }
      if (!hook.command) {
        errors.push(`钩子 "${hook.name}" 缺少 command`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
