/* Workspace 存储层 — ~/.manta-data/workspaces/{id}/workspace.json 持久化 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { type WorkspaceConfig, type CreateWorkspaceInput, type UpdateWorkspaceInput } from '@/core/types'

function workspaceDataDir(): string {
  return path.join(os.homedir(), '.manta-data', 'workspaces')
}

function workspaceDir(id: string): string {
  return path.join(workspaceDataDir(), id)
}

function workspaceFilePath(id: string): string {
  return path.join(workspaceDir(id), 'workspace.json')
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

/** 生成简短唯一 ID */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── 公开 API ───────────────────────────────────────────────

/** 获取所有工作空间列表 */
export function listWorkspaces(): WorkspaceConfig[] {
  ensureDir(workspaceDataDir())
  const workspaces: WorkspaceConfig[] = []
  try {
    const entries = fs.readdirSync(workspaceDataDir(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const configPath = workspaceFilePath(entry.name)
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as WorkspaceConfig
          workspaces.push(config)
        } catch { /* skip corrupt files */ }
      }
    }
  } catch { /* directory might not exist yet */ }
  // 按更新时间降序排列
  return workspaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** 获取单个工作空间 */
export function getWorkspace(id: string): WorkspaceConfig | null {
  const filePath = workspaceFilePath(id)
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkspaceConfig
  } catch {
    return null
  }
}

/** 创建工作空间 */
export function createWorkspace(input: CreateWorkspaceInput): WorkspaceConfig {
  const now = new Date().toISOString()
  const config: WorkspaceConfig = {
    id: shortId(),
    name: input.name,
    description: input.description,
    agentAppIds: [],
    knowledgeBaseIds: [],
    workflowIds: [],
    createdAt: now,
    updatedAt: now,
  }

  ensureDir(workspaceDir(config.id))
  atomicWrite(workspaceFilePath(config.id), JSON.stringify(config, null, 2))
  return config
}

/** 更新工作空间 */
export function updateWorkspace(id: string, patch: UpdateWorkspaceInput): WorkspaceConfig | null {
  const existing = getWorkspace(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const updated: WorkspaceConfig = {
    ...existing,
    ...patch,
    updatedAt: now,
  }

  atomicWrite(workspaceFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/** 删除工作空间 */
export function deleteWorkspace(id: string): boolean {
  const dir = workspaceDir(id)
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
