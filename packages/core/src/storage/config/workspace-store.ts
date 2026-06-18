/* Workspace 配置持久化存储 — ~/.manta-data/workspace.json
 * 用于指定 Agent 执行文件操作时的默认工作目录
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// 配置文件路径
const DATA_DIR = path.join(os.homedir(), '.manta-data')
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspace.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/** 安全写文件（先写 tmp 再 rename） */
function safeWrite(filePath: string, data: unknown): void {
  ensureDir()
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

export interface WorkspaceSettings {
  /** 默认工作目录（绝对路径） */
  defaultDir: string
  /** 是否自动检测（优先使用项目目录） */
  autoDetect: boolean
  /** 最近使用的工作目录列表 */
  recentDirs: string[]
  /** 最后更新时间 */
  updatedAt: string
}

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  defaultDir: os.homedir(), // 默认为用户主目录
  autoDetect: true,
  recentDirs: [],
  updatedAt: new Date().toISOString(),
}

/** 读取 workspace 配置 */
export function getWorkspaceSettings(): WorkspaceSettings {
  try {
    if (fs.existsSync(WORKSPACE_FILE)) {
      const raw = fs.readFileSync(WORKSPACE_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>
      return {
        ...DEFAULT_WORKSPACE_SETTINGS,
        ...parsed,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      }
    }
  } catch {
    // 忽略解析错误，使用默认值
  }
  return { ...DEFAULT_WORKSPACE_SETTINGS }
}

/** 保存 workspace 配置 */
export function saveWorkspaceSettings(settings: WorkspaceSettings): void {
  const data = {
    ...settings,
    updatedAt: new Date().toISOString(),
  }
  safeWrite(WORKSPACE_FILE, data)
}

/** 更新 workspace 配置 */
export function updateWorkspaceSettings(updates: Partial<WorkspaceSettings>): WorkspaceSettings {
  const current = getWorkspaceSettings()
  const updated = { ...current, ...updates }
  saveWorkspaceSettings(updated)
  return updated
}

/** 添加最近使用的工作目录 */
export function addRecentWorkspaceDir(dir: string): void {
  const settings = getWorkspaceSettings()
  const recentDirs = [dir, ...settings.recentDirs.filter(d => d !== dir)].slice(0, 10)
  updateWorkspaceSettings({ recentDirs })
}

/** 获取默认工作目录 */
export function getDefaultWorkspaceDir(): string {
  const settings = getWorkspaceSettings()
  return settings.defaultDir
}
