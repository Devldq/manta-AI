/**
 * Plugin 插件存储层 — 持久化 Plugin 定义
 *
 * 存储结构：
 *   {workspace}/.manta/plugins/
 *     └── {id}.json   — 每个 Plugin 一个 JSON 文件
 *
 * 插件源文件：
 *   {project}/plugins/{id}/
 *     └── plugin.yaml — 插件清单
 */

import * as fs from 'fs'
import * as path from 'path'
import { ensureDir, atomicWrite, shortId, readJsonFile } from '../shared/fs-utils'
import type {
  PluginManifest,
  PluginDefinition,
  PluginSummary,
  PluginCapability,
  PluginLifecycleState,
  CreatePluginInput,
  UpdatePluginInput,
  InstallPluginInput,
} from '@manta/shared'

// ─── 存储路径 ─────────────────────────────────────────────────

/** 获取 Plugin JSON 存储目录 */
function getDataDir(): string {
  const root = process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, '.manta', 'plugins')
}

function pluginFilePath(pluginId: string): string {
  return path.join(getDataDir(), `${pluginId}.json`)
}

/** 获取插件源文件目录（项目 plugins/ 目录） */
export function getPluginsSourceDir(): string {
  const root = process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, 'plugins')
}

// ─── 内部索引 ─────────────────────────────────────────────────

/** 从完整定义提取摘要 */
function toSummary(def: PluginDefinition): PluginSummary {
  return {
    id: def.id,
    name: def.manifest.name,
    version: def.manifest.version,
    description: def.manifest.description,
    author: def.manifest.author,
    state: def.state,
    enabled: !def.manifest.disabled,
    capabilities: def.capabilities || [],
    tags: def.manifest.tags,
    icon: def.manifest.icon,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  }
}

// ─── CRUD 函数 ────────────────────────────────────────────────

/**
 * 获取所有 Plugin 列表（按 updatedAt 倒序）
 */
export function listPlugins(search?: string): PluginSummary[] {
  const dataDir = getDataDir()
  ensureDir(dataDir)
  const plugins: PluginDefinition[] = []

  try {
    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(dataDir, file)
      try {
        const plugin = readJsonFile<PluginDefinition>(fp)
        if (plugin && plugin.id && plugin.manifest) {
          plugins.push(plugin)
        }
      } catch {
        // 跳过损坏的文件
      }
    }
  } catch {
    // 目录读取失败
  }

  let filtered = plugins
  if (search) {
    const lower = search.toLowerCase()
    filtered = plugins.filter(
      (p) =>
        p.manifest.name.toLowerCase().includes(lower) ||
        (p.manifest.description || '').toLowerCase().includes(lower) ||
        p.id.toLowerCase().includes(lower),
    )
  }

  return filtered
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
    .map(toSummary)
}

/**
 * 获取单个 Plugin 完整定义
 */
export function getPlugin(id: string): PluginDefinition | null {
  return readJsonFile<PluginDefinition>(pluginFilePath(id))
}

/**
 * 安装新 Plugin
 */
export function installPlugin(input: InstallPluginInput): PluginDefinition {
  ensureDir(getDataDir())

  // 从 manifest 中提取 id（通过扫描源目录获取）
  const manifest: PluginManifest = {
    id: input.source, // 将被 scanner 覆盖
    name: input.source,
    version: input.version || '1.0.0',
    isNpm: input.isNpm,
    sourcePath: input.source,
  }

  const id = `plugin-${shortId()}`
  const now = new Date().toISOString()

  const def: PluginDefinition = {
    id,
    manifest,
    state: 'installed',
    installedAt: now,
    capabilities: manifest.capabilities || [],
    createdAt: now,
    updatedAt: now,
  }

  atomicWrite(pluginFilePath(id), JSON.stringify(def, null, 2))
  return def
}

/**
 * 注册已安装的 Plugin（从 plugin.yaml 扫描结果注册）
 */
export function registerPlugin(manifest: PluginManifest, installPath?: string): PluginDefinition {
  ensureDir(getDataDir())

  // 检查是否已存在
  const existingList = listPlugins()
  const existing = existingList.find(
    (p) => p.name === manifest.name || p.id === manifest.id,
  )

  const now = new Date().toISOString()

  if (existing) {
    // 更新已有插件
    const existingDef = getPlugin(existing.id)
    if (existingDef) {
      const updated: PluginDefinition = {
        ...existingDef,
        manifest: { ...existingDef.manifest, ...manifest, id: existingDef.id },
        capabilities: manifest.capabilities || existingDef.capabilities || [],
        installPath: installPath || existingDef.installPath,
        updatedAt: now,
      }
      atomicWrite(pluginFilePath(existing.id), JSON.stringify(updated, null, 2))
      return updated
    }
  }

  // 新建
  const id = `plugin-${shortId()}`
  const def: PluginDefinition = {
    id,
    manifest: { ...manifest, id },
    state: 'active',
    installedAt: now,
    activatedAt: now,
    capabilities: manifest.capabilities || [],
    installPath,
    createdAt: now,
    updatedAt: now,
  }

  atomicWrite(pluginFilePath(id), JSON.stringify(def, null, 2))
  return def
}

/**
 * 更新 Plugin
 */
export function updatePlugin(
  id: string,
  input: UpdatePluginInput,
): PluginDefinition | null {
  const existing = getPlugin(id)
  if (!existing) return null

  const updated: PluginDefinition = {
    ...existing,
    manifest: input.manifest
      ? { ...existing.manifest, ...input.manifest }
      : existing.manifest,
    state: input.state ?? existing.state,
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(pluginFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 删除 Plugin
 */
export function deletePlugin(id: string): boolean {
  const fp = pluginFilePath(id)
  try {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 启用 Plugin
 */
export function enablePlugin(id: string): PluginDefinition | null {
  const existing = getPlugin(id)
  if (!existing) return null

  const updated: PluginDefinition = {
    ...existing,
    state: 'active' as PluginLifecycleState,
    manifest: { ...existing.manifest, disabled: false },
    activatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(pluginFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 禁用 Plugin
 */
export function disablePlugin(id: string): PluginDefinition | null {
  const existing = getPlugin(id)
  if (!existing) return null

  const updated: PluginDefinition = {
    ...existing,
    state: 'installed' as PluginLifecycleState,
    manifest: { ...existing.manifest, disabled: true },
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(pluginFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 根据 plugin.yaml 的 id 查找 Plugin
 */
export function findPluginByManifestId(manifestId: string): PluginDefinition | null {
  const summaries = listPlugins()
  const match = summaries.find((s) => s.name === manifestId || s.id === manifestId)
  if (!match) return null
  return getPlugin(match.id)
}

/**
 * 获取所有激活的 Plugin
 */
export function getActivePlugins(): PluginDefinition[] {
  const dataDir = getDataDir()
  ensureDir(dataDir)
  const plugins: PluginDefinition[] = []

  try {
    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(dataDir, file)
      try {
        const plugin = readJsonFile<PluginDefinition>(fp)
        if (
          plugin &&
          plugin.state === 'active' &&
          !plugin.manifest.disabled
        ) {
          plugins.push(plugin)
        }
      } catch {
        // 跳过
      }
    }
  } catch {
    // 读取失败
  }

  return plugins
}
