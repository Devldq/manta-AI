/* Workspace 配置持久化存储 — ~/.manta-data/workspace.json
 * 用于指定 Agent 执行文件操作时的默认工作目录
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// 配置文件路径
const DATA_DIR = path.join(os.homedir(), '.manta-data')
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspace.json')

/** 延迟引用安全上下文（通过 AsyncLocalStorage），避免模块加载时的循环依赖 */
function getSecurityContextOrNull(): { allowedRoots: string[] } | undefined {
  // 运行时动态 require，避免模块解析顺序问题
  try {
    const { getSecurityContext } = require('../../security-context')
    return getSecurityContext()
  } catch {
    return undefined
  }
}

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

export interface WorkspaceConfig {
  /** 默认工作目录（绝对路径） */
  defaultDir: string
  /** 是否自动检测（优先使用项目目录） */
  autoDetect: boolean
  /** 最近使用的工作目录列表 */
  recentDirs: string[]
  /** 最后更新时间 */
  updatedAt: string
}

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  defaultDir: os.homedir(), // 默认为用户主目录
  autoDetect: true,
  recentDirs: [],
  updatedAt: new Date().toISOString(),
}

/** 读取 workspace 配置 */
export function getWorkspaceConfig(): WorkspaceConfig {
  try {
    if (fs.existsSync(WORKSPACE_FILE)) {
      const raw = fs.readFileSync(WORKSPACE_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>
      return {
        ...DEFAULT_WORKSPACE_CONFIG,
        ...parsed,
      }
    }
  } catch {
    // 读取失败使用默认值
  }
  return { ...DEFAULT_WORKSPACE_CONFIG }
}

/** 保存 workspace 配置 */
export function saveWorkspaceConfig(config: WorkspaceConfig): void {
  const updated = {
    ...config,
    updatedAt: new Date().toISOString(),
  }
  safeWrite(WORKSPACE_FILE, updated)
}

/**
 * 获取默认工作目录
 * 优先级：环境变量 > 配置文件 > 智能检测 > 用户主目录
 */
export function getDefaultWorkDir(): string {
  // 0. 安全上下文的工作空间（最高优先级 — agent loop 运行时通过 AsyncLocalStorage 注入）
  const ctx = getSecurityContextOrNull()
  if (ctx?.allowedRoots?.[0] && fs.existsSync(ctx.allowedRoots[0]) && fs.statSync(ctx.allowedRoots[0]).isDirectory()) {
    return path.resolve(ctx.allowedRoots[0])
  }

  // 1. 环境变量优先
  const envDir = process.env.MANTA_WORKDIR
  if (envDir && fs.existsSync(envDir) && fs.statSync(envDir).isDirectory()) {
    return path.resolve(envDir)
  }

  // 2. 配置文件（只有存在且包含有效 defaultDir 时才使用）
  if (fs.existsSync(WORKSPACE_FILE)) {
    const config = getWorkspaceConfig()
    if (config.defaultDir && fs.existsSync(config.defaultDir) && fs.statSync(config.defaultDir).isDirectory()) {
      return path.resolve(config.defaultDir)
    }
  }

  // 3. 智能检测：尝试找到项目根目录（有 package.json 或 tsconfig.json）
  const detected = detectProjectRoot()
  if (detected) return detected

  // 4. 降级到用户主目录
  return os.homedir()
}

/**
 * 智能检测项目根目录
 * 从当前目录向上查找 package.json 或 tsconfig.json
 */
function detectProjectRoot(): string | null {
  // 从 process.cwd() 开始向上查找
  let current = process.cwd()
  const root = path.parse(current).root // 到达文件系统根就停止

  while (current !== root) {
    // 检查常见的项目标识文件
    if (
      fs.existsSync(path.join(current, 'package.json')) ||
      fs.existsSync(path.join(current, 'tsconfig.json')) ||
      fs.existsSync(path.join(current, 'go.mod')) ||
      fs.existsSync(path.join(current, 'Cargo.toml')) ||
      fs.existsSync(path.join(current, 'pom.xml')) ||
      fs.existsSync(path.join(current, 'requirements.txt'))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

/**
 * 添加到最近使用目录
 */
export function addRecentDir(dir: string): void {
  const config = getWorkspaceConfig()
  const resolved = path.resolve(dir)

  // 过滤掉不存在的目录
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return
  }

  // 移除已存在的（避免重复）
  const filtered = config.recentDirs.filter((d) => d !== resolved)

  // 添加到开头
  config.recentDirs = [resolved, ...filtered].slice(0, 10) // 最多保留 10 个

  saveWorkspaceConfig(config)
}

/**
 * 设置默认工作目录
 */
export function setDefaultWorkDir(dir: string): void {
  const resolved = path.resolve(dir)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`目录不存在或不是有效目录: ${resolved}`)
  }
  const config = getWorkspaceConfig()
  config.defaultDir = resolved
  saveWorkspaceConfig(config)
}
