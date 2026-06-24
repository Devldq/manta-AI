/**
 * 审计日志器 - 记录所有工具操作
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { AuditEntry } from '../types'

/**
 * 审计日志存储目录
 */
const AUDIT_DIR = path.join(os.homedir(), '.manta-data')

/**
 * 审计日志文件路径
 */
const AUDIT_LOG_FILE = path.join(AUDIT_DIR, 'audit.log')

/**
 * 确保审计日志目录存在
 */
function ensureAuditDir(): void {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true })
  }
}

/**
 * 写入审计日志
 * @param entry 审计日志条目
 */
export function log(entry: AuditEntry): void {
  ensureAuditDir()
  
  // 使用 JSON Lines 格式（每行一个 JSON 对象）
  const line = JSON.stringify(entry) + '\n'
  
  fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf-8')
}

/**
 * 读取审计日志
 * @param options 读取选项
 * @returns 审计日志条目列表
 */
export function readLogs(options?: {
  taskId?: string
  workspaceId?: string
  action?: string
  startTime?: string
  endTime?: string
  limit?: number
}): AuditEntry[] {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return []
  }
  
  const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8')
  const lines = content.trim().split('\n').filter(Boolean)
  
  let entries: AuditEntry[] = lines
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEntry
      } catch {
        return null
      }
    })
    .filter((entry): entry is AuditEntry => entry !== null)
  
  // 应用过滤条件
  if (options?.taskId) {
    entries = entries.filter((e) => e.taskId === options.taskId)
  }
  
  if (options?.workspaceId) {
    entries = entries.filter((e) => e.workspaceId === options.workspaceId)
  }
  
  if (options?.action) {
    entries = entries.filter((e) => e.action === options.action)
  }
  
  if (options?.startTime) {
    entries = entries.filter((e) => e.timestamp >= options.startTime!)
  }
  
  if (options?.endTime) {
    entries = entries.filter((e) => e.timestamp <= options.endTime!)
  }
  
  // 应用限制
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(-options.limit)
  }
  
  return entries
}

/**
 * 清除审计日志
 */
export function clearLogs(): void {
  if (fs.existsSync(AUDIT_LOG_FILE)) {
    fs.unlinkSync(AUDIT_LOG_FILE)
  }
}

/**
 * 获取审计日志文件大小
 * @returns 文件大小（字节）
 */
export function getLogSize(): number {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return 0
  }
  
  const stats = fs.statSync(AUDIT_LOG_FILE)
  return stats.size
}

/**
 * 创建审计日志条目
 * @param params 创建参数
 * @returns 审计日志条目
 */
export function createAuditEntry(params: {
  taskId: string
  workspaceId?: string
  action: string
  path?: string
  command?: string
  approved: boolean
  durationMs: number
}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    action: params.action,
    path: params.path,
    command: params.command,
    approved: params.approved,
    durationMs: params.durationMs,
  }
}
