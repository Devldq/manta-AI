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
import { requestToolApproval } from '@security/request-approval'

// ─── 使用共享安全上下文模块（解决 tsx 模块解析问题）────────────────────

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getSecurityContext, type SecurityContext as SecurityContextType } from '../../security-context'
import { currentDiagnosticsOwner } from '../../../storage/runtime-diagnostics'

// ─── 类型定义 ────────────────────────────────────────────────────────────────────

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

function auditLog(entry: AuditEntry): void {
  currentDiagnosticsOwner()?.appendAudit({ ...entry })
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

function shellInvocation(command: string): { executable: string; args: string[] } {
  if (process.platform === 'win32') return { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  return { executable: process.env.SHELL || '/bin/sh', args: ['-lc', command] }
}

function spawnShell(command: string, cwd: string): child_process.ChildProcess {
  const invocation = shellInvocation(command)
  return child_process.spawn(invocation.executable, invocation.args, {
    cwd,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function terminateProcessTree(proc: child_process.ChildProcess): void {
  if (!proc.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-proc.pid, 'SIGTERM')
    else proc.kill('SIGTERM')
  } catch { /* process already exited */ }
}

async function runForegroundCommand(command: string, cwd: string, timeoutMs: number, context?: SecurityContextType): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawnShell(command, cwd)
  if (!proc.pid) throw new Error('Shell process did not expose a PID')
  context?.registerProcess?.(proc.pid, 'bash')
  let stdout = ''
  let stderr = ''
  proc.stdout?.on('data', (chunk) => { stdout += String(chunk) })
  proc.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      context?.abortSignal?.removeEventListener('abort', abort)
      context?.unregisterProcess?.(proc.pid!)
      operation()
    }
    const abort = () => {
      terminateProcessTree(proc)
      finish(() => reject(Object.assign(new Error('Job execution was cancelled'), { code: 'JOB_EXECUTION_ABORTED' })))
    }
    const timer = setTimeout(() => {
      terminateProcessTree(proc)
      finish(() => reject(Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), { code: 'COMMAND_TIMEOUT', stderr })))
    }, timeoutMs)
    timer.unref()
    context?.abortSignal?.addEventListener('abort', abort, { once: true })
    if (context?.abortSignal?.aborted) return abort()
    proc.once('error', (error) => finish(() => reject(error)))
    proc.once('close', (code) => finish(() => code === 0
      ? resolve({ stdout, stderr, exitCode: 0 })
      : reject(Object.assign(new Error(`Command exited with code ${code ?? 1}`), { code: 'COMMAND_FAILED', stderr, stdout, exitCode: code ?? 1 }))))
  })
}

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
      // ★ 默认 cwd：优先使用安全上下文的 shellAllowedRoots[0]，其次 process.cwd()
      const defaultCwd = getSecurityContext()?.shellAllowedRoots?.[0] || process.cwd()
      const { command, cwd: targetCwd = defaultCwd, timeout = 10000, run_in_background = false } = input
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
          const approved = await requestToolApproval({ type: 'shell', command })
          
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
          
          const context = getSecurityContext()
          const proc = spawnShell(command, targetCwd)
          if (!proc.pid) throw new Error('Shell process did not expose a PID')
          context?.registerProcess?.(proc.pid, 'bash-background')
          proc.stdout?.on('data', (chunk) => { task.stdout += String(chunk) })
          proc.stderr?.on('data', (chunk) => { task.stderr += String(chunk) })
          const timeoutHandle = setTimeout(() => terminateProcessTree(proc), timeout)
          timeoutHandle.unref()
          const abort = () => { terminateProcessTree(proc); task.status = 'killed' }
          context?.abortSignal?.addEventListener('abort', abort, { once: true })
          proc.once('error', (error) => { task.stderr += error.message; task.exitCode = 1; task.status = 'failed' })
          proc.once('close', (code) => {
            clearTimeout(timeoutHandle)
            context?.abortSignal?.removeEventListener('abort', abort)
            context?.unregisterProcess?.(proc.pid!)
            task.exitCode = code ?? 1
            if (task.status === 'running') task.status = code === 0 ? 'completed' : 'failed'
          })
          task.proc = proc
          bashTaskRegistry.set(taskId, task)
          
          return {
            task_id: taskId,
            status: 'running',
            message: '任务已在后台启动',
          }
        } else {
          const result = await runForegroundCommand(command, targetCwd, timeout, getSecurityContext())
          return {
            command,
            output: result.stdout,
            stderr: result.stderr,
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
      if (task.proc) terminateProcessTree(task.proc)
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
