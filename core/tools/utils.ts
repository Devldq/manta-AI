/* core/tools/utils — 工具集共享的工具函数
 *
 * 从 file-tools.ts 和 shell-tools.ts 中提取的重复逻辑：
 * - 参数解析 (parseInput, extractFilePath, extractDirPath)
 * - 文件系统遍历 (walkFiles, globToRegExp)
 * - 访问控制 (checkAccess)
 * - Bash 安全检查 (checkCommand)
 * - Todo 持久化 (readTodos, writeTodos)
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { isApproved, requestAccess, listPendingRequests } from '@/core/fs/access-store'

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

/** 解析 AI SDK 可能的参数格式 */
export function parseInput(raw: any): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (typeof raw.args === 'string') {
      try { return JSON.parse(raw.args) } catch { /* ignore */ }
    }
    if (typeof raw.input === 'string') {
      try { return JSON.parse(raw.input) } catch { return { path: raw.input } }
    }
    return raw
  }
  if (typeof raw === 'string') {
    return { path: raw }
  }
  return {}
}

/** 从参数对象中提取文件路径（支持多种参数名） */
export function extractFilePath(params: Record<string, unknown>): string {
  const keys = ['file_path', 'path', 'file', 'filename', 'name', 'value', 'input', 'target']
  for (const key of keys) {
    if (params[key] && typeof params[key] === 'string') {
      return params[key] as string
    }
  }
  return ''
}

/** 从参数对象中提取目录路径（支持多种参数名） */
export function extractDirPath(params: Record<string, unknown>): string {
  const keys = ['dir_path', 'path', 'dir', 'directory', 'target', 'name', 'value', 'input']
  for (const key of keys) {
    if (params[key] && typeof params[key] === 'string') {
      return params[key] as string
    }
  }
  return ''
}

// ─── 文件系统遍历 ─────────────────────────────────────────────────────────────

/** 将 glob 模式转为 RegExp（支持 * ** ? 三种通配符） */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00DOUBLESTAR\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00DOUBLESTAR\x00/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

/** 递归收集目录下所有文件 */
export function walkFiles(dir: string, result: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, result)
    } else if (entry.isFile()) {
      result.push(full)
    }
  }
  return result
}

// ─── 访问控制 ─────────────────────────────────────────────────────────────────

/**
 * 解析路径并检查授权：
 * - 已授权 → 返回 resolved 路径
 * - 未授权 → 发起授权请求，轮询等待（最多 120s），授权后继续；超时或拒绝返回 error
 */
export async function checkAccess(targetPath: string): Promise<{ resolved: string } | { error: string }> {
  const resolved = path.resolve(targetPath)
  if (isApproved(resolved)) {
    return { resolved }
  }

  const req = requestAccess(resolved)
  const timeout = 120_000
  const interval = 500
  const start = Date.now()

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, interval))
    if (isApproved(resolved)) {
      return { resolved }
    }
    const stillPending = listPendingRequests().some((r) => r.id === req.id)
    if (!stillPending && !isApproved(resolved)) {
      return { error: `用户拒绝了对 "${resolved}" 的访问请求` }
    }
  }

  return { error: `等待授权超时（120s），无法访问 "${resolved}"` }
}

// ─── Bash 安全检查 ───────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+[\/\*]/, message: '禁止执行 rm -rf / 或 rm -rf /*' },
  { pattern: /:\!\s*rm\s+-rf/, message: '禁止执行 shell 历史中的 rm -rf' },
]

const DELETE_FILE_PATTERNS = [
  { pattern: /^\s*rm\s+-/i, message: '删除文件需要审批' },
  { pattern: /^\s*unlink\s*\(/i, message: '删除文件需要审批' },
  { pattern: /^\s*del\s+/i, message: '删除文件需要审批' },
]

const DELETE_DIR_PATTERNS = [
  { pattern: /^\s*rmdir\s+/i, message: '删除文件夹需要审批' },
  { pattern: /^\s*rm\s+-r\s/i, message: '删除文件夹需要审批' },
]

export function checkCommand(command: string): string | null {
  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return message
  }
  for (const { pattern, message } of DELETE_FILE_PATTERNS) {
    if (pattern.test(command)) return message
  }
  for (const { pattern, message } of DELETE_DIR_PATTERNS) {
    if (pattern.test(command)) return message
  }
  return null
}

// ─── Todo 持久化 ─────────────────────────────────────────────────────────────

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
}

const TODO_FILE = path.join(os.homedir(), '.manta-data', 'todos.json')

export function readTodos(): TodoItem[] {
  try {
    if (fs.existsSync(TODO_FILE)) {
      return JSON.parse(fs.readFileSync(TODO_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

export function writeTodos(todos: TodoItem[]): void {
  const dir = path.dirname(TODO_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf-8')
}
