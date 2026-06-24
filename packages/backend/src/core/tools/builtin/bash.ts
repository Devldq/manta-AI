/* core/tools/bash — Bash 命令执行工具集（接入安全沙箱 SDK）
 *
 * 工具列表：
 * - bash       — 执行 shell 命令（支持后台运行）
 * - bashOutput — 获取后台任务输出
 * - bashKill   — 终止后台任务
 */
import type { ToolDefinition } from '@tools/registry'
import * as child_process from 'child_process'
import { checkCommand } from './utils'
import { approvalManager } from '@security/ApprovalManager'

// ─── 从 @manta/agent-sandbox 复制的必要函数 ─────────────────────────────────

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ─── 类型定义 ────────────────────────────────────────────────────────────────────

interface SecurityContextType {
  taskId?: string
  workspaceId?: string
  allowedRoots: string[]
  shellAllowedRoots: string[]
  networkAccess: boolean
  maxFileSize: number
  platform: string
}

interface CommandValidationResult {
  allowed: boolean
  needApproval: boolean
  reason?: string
  resolvedPaths: string[]
}

interface AuditEntry {
  timestamp: string
  taskId?: string
  workspaceId?: string
  action: string
  path?: string
  command?: string
  approved?: boolean
  durationMs?: number
}

// ─── 安全上下文存储（简化版）────────────────────────────────────────────────────

const securityContextStorage: { getStore: () => SecurityContextType | undefined } = {
  getStore: () => undefined,
}

// ─── 路径验证函数 ───────────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1))
  }
  return path.resolve(filePath)
}

function isPathInAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  if (!allowedRoots || allowedRoots.length === 0) return false
  const normalizedTarget = normalizePath(targetPath)
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizePath(root)
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep)
  })
}

// ─── 命令验证函数 ───────────────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /mkfs\./,                  // mkfs 命令
  /dd\s+if=/,                // dd 命令
  />\s*\/dev\/\w+/,          // 重定向到设备
  /chmod\s+777/,             // chmod 777
  /curl\s+.*\|.*sh/,         // curl ... | sh
  /wget\s+.*\|.*sh/,         // wget ... | sh
]

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))
}

function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = []
  const absolutePathPattern = /(?:^|\s)(?:~|\/|(?:[A-Za-z]:\\))(?:[^\s<>|&;()[\]{}]+)/g
  let match: RegExpExecArray | null
  const cmd = command
  while ((match = absolutePathPattern.exec(cmd)) !== null) {
    const extractedPath = match[1] || match[0]
    if (extractedPath) {
      paths.push(extractedPath.trim())
    }
  }
  return paths
}

function getSecurityContext(): SecurityContextType | undefined {
  return securityContextStorage.getStore()
}

function validateCommand(command: string, cwd: string): CommandValidationResult {
  const context = getSecurityContext()
  
  if (!context) {
    return {
      allowed: false,
      needApproval: false,
      reason: '安全上下文未初始化',
      resolvedPaths: [],
    }
  }
  
  const isCwdAllowed = isPathInAllowedRoots(cwd, context.shellAllowedRoots)
  
  if (!isCwdAllowed) {
    return {
      allowed: false,
      needApproval: false,
      reason: `执行路径 ${cwd} 不在允许的 Shell 执行路径内`,
      resolvedPaths: [],
    }
  }
  
  const resolvedPaths = extractPathsFromCommand(command)
  
  for (const resolvedPath of resolvedPaths) {
    const isPathAllowed = isPathInAllowedRoots(resolvedPath, context.allowedRoots)
    
    if (!isPathAllowed) {
      return {
        allowed: false,
        needApproval: true,
        reason: `命令中包含不允许访问的路径: ${resolvedPath}`,
        resolvedPaths,
      }
    }
  }
  
  if (isDangerousCommand(command)) {
    return {
      allowed: false,
      needApproval: true,
      reason: '命令包含危险操作，需要授权',
      resolvedPaths,
    }
  }
  
  return {
    allowed: true,
    needApproval: false,
    resolvedPaths,
  }
}

// ─── 审计日志函数 ───────────────────────────────────────────────────────────────

const AUDIT_DIR = path.join(os.homedir(), '.manta-data')
const AUDIT_LOG_FILE = path.join(AUDIT_DIR, 'audit.log')

function ensureAuditDir(): void {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true })
  }
}

function auditLog(entry: AuditEntry): void {
  ensureAuditDir()
  const line = JSON.stringify(entry) + '\n'
  fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf-8')
}

function createAuditEntry(params: {
  taskId?: string
  workspaceId?: string
  action: string
  path?: string
  command?: string
  approved?: boolean
  durationMs?: number
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

// ─── 后台任务注册表 ──────────────────────────────────────────────────────────

interface BashTask {
  task_id: string
  command: string
  cwd: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  stdout: string
  stderr: string
  exitCode: number | null
  proc?: child_process.ChildProcess
}

const bashTaskRegistry = new Map<string, BashTask>()
let bashTaskCounter = 0

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** Bash — 在 shell 中执行命令 */
function createBashTool(): ToolDefinition {
  return {
    name: 'bash',
    description: '在 shell 中执行命令。支持 cwd、timeout、后台运行。危险操作（删除文件/文件夹）需要审批。避免使用 find、grep、cat 等命令，优先使用专用工具（Read/Grep/Glob）。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        description: { type: 'string', description: '命令的简短描述（3-10 个词）' },
        cwd: { type: 'string', description: '工作目录，默认为当前目录' },
        timeout: {
          type: 'integer',
          minimum: 1000,
          maximum: 600000,
          description: '超时时间（毫秒），默认 10000ms，最大 600000ms',
        },
        run_in_background: {
          type: 'boolean',
          description: '是否后台运行，返回 task_id 供后续查询',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    shouldDefer: true,
    isConcurrencySafe: false,
    searchHint: 'run execute shell command bash terminal script',
    execute: async (input: any) => {
      const { command, cwd: targetCwd = process.cwd(), timeout = 10000, run_in_background = false } = input
      const startTime = Date.now()
      
      // 1. 检查危险命令（保留原有逻辑）
      const unsafe = checkCommand(command)
      if (unsafe) {
        return { command, error: unsafe }
      }
      
      // 2. 路径安全校验
      const validation = validateCommand(command, targetCwd)
      if (!validation.allowed) {
        // 如果需要授权，创建授权请求并等待用户响应
        if (validation.needApproval) {
          const context = getSecurityContext()
          const requestedBy = context?.taskId || 'unknown'
          
          // 创建授权请求
          const requestId = approvalManager.createRequest('shell', requestedBy, undefined, command)
          
          // 等待用户响应（最多 60 秒）
          const approved = await approvalManager.waitForResponse(requestId, 60000)
          
          if (!approved) {
            // 记录审计日志（拒绝）
            if (context) {
              auditLog(createAuditEntry({
                taskId: context.taskId,
                workspaceId: context.workspaceId,
                action: 'bash',
                command,
                approved: false,
                durationMs: Date.now() - startTime,
              }))
            }
            return { command, error: '用户拒绝执行或超时' }
          }
          
          // 用户已批准，继续执行
          // 记录审计日志（批准）
          if (context) {
            auditLog(createAuditEntry({
              taskId: context.taskId,
              workspaceId: context.workspaceId,
              action: 'bash',
              command,
              approved: true,
              durationMs: Date.now() - startTime,
            }))
          }
        } else {
          // 记录审计日志（拒绝）
          const context = getSecurityContext()
          if (context) {
            auditLog(createAuditEntry({
              taskId: context.taskId,
              workspaceId: context.workspaceId,
              action: 'bash',
              command,
              approved: false,
              durationMs: Date.now() - startTime,
            }))
          }
          return { command, error: validation.reason || '命令不允许执行' }
        }
      }
      
      // 3. 执行命令
      try {
        if (run_in_background) {
          // 后台运行
          const taskId = `bash_${++bashTaskCounter}_${Date.now()}`
          const task: BashTask = {
            task_id: taskId,
            command,
            cwd: targetCwd,
            startedAt: Date.now(),
            status: 'running',
            stdout: '',
            stderr: '',
            exitCode: null,
          }
          
          const proc = child_process.exec(command, {
            cwd: targetCwd,
            timeout,
          }, (error, stdout, stderr) => {
            task.stdout += stdout || ''
            task.stderr += stderr || ''
            task.exitCode = error ? (error as any).code || 1 : 0
            task.status = error ? 'failed' : 'completed'
          })
          
          task.proc = proc
          bashTaskRegistry.set(taskId, task)
          
          return {
            task_id: taskId,
            status: 'running',
            message: '任务已在后台启动',
          }
        } else {
          // 同步执行
          const { execSync } = child_process
          const output = execSync(command, {
            cwd: targetCwd,
            timeout,
            encoding: 'utf-8',
          })
          
          return {
            command,
            output: output || '',
            status: 'completed',
          }
        }
      } catch (error: any) {
        return {
          command,
          error: error.message || '命令执行失败',
          stderr: error.stderr || '',
          status: 'failed',
        }
      }
    },
  }
}

/** BashOutput — 获取后台 Bash 任务的输出 */
function createBashOutputTool(): ToolDefinition {
  return {
    name: 'bashOutput',
    description: '获取后台运行的 Bash 任务的当前输出和状态。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '后台任务 ID（由 Bash 工具返回）' },
        block: {
          type: 'boolean',
          description: '是否等待任务完成再返回（默认 false）',
        },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'get check background task output status result',
    execute: async (input: any) => {
      const { task_id, block = false } = input
      const task = bashTaskRegistry.get(task_id)
      if (!task) {
        return { error: `任务 ${task_id} 不存在` }
      }
      
      if (block && task.status === 'running') {
        const start = Date.now()
        while (task.status === 'running' && Date.now() - start < 30000) {
          await new Promise((r) => setTimeout(r, 300))
        }
      }
      
      return {
        task_id: task.task_id,
        command: task.command,
        status: task.status,
        exitCode: task.exitCode,
        stdout: task.stdout.slice(0, 50000),
        stderr: task.stderr.slice(0, 10000),
        elapsedMs: Date.now() - task.startedAt,
      }
    },
  }
}

/** BashKill — 终止后台运行的 Bash 任务 */
function createBashKillTool(): ToolDefinition {
  return {
    name: 'bashKill',
    description: '终止后台运行的 Bash 任务',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '后台任务 ID' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'kill stop terminate cancel background task bash',
    execute: async (input: any) => {
      const { task_id } = input
      const task = bashTaskRegistry.get(task_id)
      if (!task) {
        return { error: `任务 ${task_id} 不存在` }
      }
      if (task.status !== 'running') {
        return { task_id, status: task.status, message: `任务已结束，无法终止` }
      }
      task.proc?.kill()
      task.status = 'killed'
      task.exitCode = null
      return { task_id, status: 'killed', message: `任务已终止` }
    },
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有 Bash 相关工具 */
export function createBashTools(): ToolDefinition[] {
  return [
    createBashTool(),
    createBashOutputTool(),
    createBashKillTool(),
  ]
}
