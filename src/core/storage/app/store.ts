/*  App 存储层 — ~/.manta-data/apps/{id}/app.json 持久化 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { type AppConfig, type CreateAppInput, type UpdateAppInput } from '@/core/types'

function appDataDir(): string {
  return path.join(os.homedir(), '.manta-data', 'apps')
}

function appDir(appId: string): string {
  return path.join(appDataDir(), appId)
}

function appFilePath(appId: string): string {
  return path.join(appDir(appId), 'app.json')
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 原子写入：先写 .tmp 再 rename */
function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, data, 'utf-8')
  fs.renameSync(tmp, filePath)
}

/** 生成简短唯一 ID（取 uuid 前 8 位） */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** 创建默认的应用配置 */
function createDefaultConfig(input: CreateAppInput): AppConfig {
  const now = new Date().toISOString()
  return {
    id: shortId(),
    name: input.name,
    description: input.description ?? '',
    icon: input.icon ?? '🤖',
    tags: input.tags ?? [],
    status: 'draft',
    agentId: '',
    agentOverride: {},
    ragBinding: null,
    enabledTools: [],
    automations: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    version: 1,
  }
}

// ─── 公开 API ───────────────────────────────────────────────

/** 获取所有应用列表 */
export function listApps(): AppConfig[] {
  ensureDir(appDataDir())
  const apps: AppConfig[] = []
  try {
    const entries = fs.readdirSync(appDataDir(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const configPath = appFilePath(entry.name)
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppConfig
          apps.push(config)
        } catch { /* skip corrupt files */ }
      }
    }
  } catch { /* directory might not exist yet */ }
  return apps
}

/** 获取单个应用 */
export function getApp(id: string): AppConfig | null {
  const filePath = appFilePath(id)
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AppConfig
  } catch {
    return null
  }
}

/** 创建应用 */
export function createApp(input: CreateAppInput): AppConfig {
  const config = createDefaultConfig(input)
  ensureDir(appDir(config.id))
  atomicWrite(appFilePath(config.id), JSON.stringify(config, null, 2))
  return config
}

/** 更新应用 */
export function updateApp(id: string, patch: UpdateAppInput): AppConfig | null {
  const existing = getApp(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const updated: AppConfig = {
    ...existing,
    ...patch,
    agentOverride: {
      ...existing.agentOverride,
      ...patch.agentOverride,
    },
    updatedAt: now,
    version: existing.version + 1,
  }

  // 处理 ragBinding：null 表示解除绑定
  if ('ragBinding' in patch) {
    updated.ragBinding = patch.ragBinding as AppConfig['ragBinding']
  }

  atomicWrite(appFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/** 删除应用 */
export function deleteApp(id: string): boolean {
  const dir = appDir(id)
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  } catch {
    return false
  }
}

/** 复制应用 */
export function cloneApp(id: string, newName?: string): AppConfig | null {
  const source = getApp(id)
  if (!source) return null

  const now = new Date().toISOString()
  const cloned: AppConfig = {
    ...source,
    id: shortId(),
    name: newName ?? `${source.name} (副本)`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    version: 1,
  }

  ensureDir(appDir(cloned.id))
  atomicWrite(appFilePath(cloned.id), JSON.stringify(cloned, null, 2))
  return cloned
}

/** 更改应用状态 */
export function updateAppStatus(id: string, status: AppConfig['status']): AppConfig | null {
  const existing = getApp(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const updated: AppConfig = {
    ...existing,
    status,
    updatedAt: now,
    publishedAt: status === 'published' ? existing.publishedAt ?? now : existing.publishedAt,
    version: existing.version + 1,
  }

  atomicWrite(appFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}
