/* core/tools/bash — Bash 命令执行工具集
 *
 * 工具列表：
 * - bash       — 执行 shell 命令（支持后台运行）
 * - bashOutput — 获取后台任务输出
 * - bashKill   — 终止后台任务
 */
import type { ToolDefinition } from '@tools/registry'
import * as child_process from 'child_process'
import { checkCommand } from './utils'

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

      const unsafe = checkCommand(command)
      if (unsafe) {
        return { command, error: unsafe }
      }

      if (run_in_background) {
        const task_id = `bash_${++bashTaskCounter}_${Date.now()}`
        const task: BashTask = {
          task_id,
          command,
          cwd: targetCwd,
          startedAt: Date.now(),
          status: 'running',
          stdout: '',
          stderr: '',
          exitCode: null,
        }
        bashTaskRegistry.set(task_id, task)

        const proc = child_process.exec(command, { cwd: targetCwd, timeout })
        task.proc = proc
        proc.stdout?.on('data', (d: string) => { task.stdout += d })
        proc.stderr?.on('data', (d: string) => { task.stderr += d })
        proc.on('close', (code: number | null) => {
          task.status = code === 0 ? 'completed' : 'failed'
          task.exitCode = code
        })

        return { task_id, status: 'running', message: `命令已在后台启动，task_id: ${task_id}` }
      }

      return new Promise<{ command: string; stdout: string; stderr: string; exitCode: number | null; error?: string }>((resolve) => {
        child_process.exec(command, { cwd: targetCwd, timeout }, (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
            resolve({ command, stdout, stderr, exitCode: null, error: `命令超时（${timeout}ms）` })
            return
          }
          resolve({
            command,
            stdout: stdout.slice(0, 50000),
            stderr: stderr.slice(0, 10000),
            exitCode: err?.code ?? 0,
          })
        })
      })
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

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有 Bash 相关工具 */
export function createBashTools(): ToolDefinition[] {
  return [
    createBashTool(),
    createBashOutputTool(),
    createBashKillTool(),
  ]
}
