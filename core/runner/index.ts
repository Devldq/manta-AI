/*  start: Runner 层 — 所有 Runner 必须实现此接口，openclaw + claude-code 内置实现 */
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { spawn } from 'child_process'
import type { Runner, RunParams, RunResult, AgentEntry } from '../types'

// ─── 工具函数 ───────────────────────────────────────────────

// AI: 确保输出目录存在
function ensureOutputDir(outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
}

// AI: 运行 CLI 进程，收集输出（env 用宽松类型避免 NODE_ENV required 冲突）
function runCli(
  bin: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const proc = spawn(bin, args, {
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
    }, timeoutMs)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

// ─── OpenClaw Runner ───────────────────────────────────────────────

export class OpenClawRunner implements Runner {
  readonly id = 'openclaw'

  async probe(): Promise<{ available: boolean; reason?: string; version?: string }> {
    // AI: 检查 openclaw CLI 是否存在
    try {
      const result = await runCli('openclaw', ['--version'], {}, 5000)
      if (result.exitCode === 0) {
        return { available: true, version: result.stdout.trim() }
      }
      return { available: false, reason: 'openclaw CLI 返回非零退出码' }
    } catch {
      return { available: false, reason: 'openclaw CLI 未找到，请检查 PATH' }
    }
  }

  async run(params: RunParams): Promise<RunResult> {
    const start = Date.now()
    ensureOutputDir(params.outputDir)

    const contextFile = path.join(params.outputDir, 'task-context.json')
    fs.writeFileSync(contextFile, JSON.stringify({
      taskId: params.task.id,
      title: params.task.title,
      description: params.task.description,
      outputDir: params.outputDir,
    }, null, 2))

    const bin = params.agent.bin || 'openclaw'

    try {
      const result = await runCli(
        bin,
        ['run', '--task', contextFile],
        { ARM_OUTPUT_DIR: params.outputDir },
        60 * 60 * 1000 // 1h timeout
      )

      const outputFiles = fs.readdirSync(params.outputDir)
        .filter((f) => f !== 'task-context.json')
        .map((f) => path.join(params.outputDir, f))

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        outputFiles,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        exitCode: -1,
        outputFiles: [],
        error: String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// ─── Claude Code Runner ───────────────────────────────────────────────

export class ClaudeCodeRunner implements Runner {
  readonly id = 'claude-code'

  async probe(): Promise<{ available: boolean; reason?: string; version?: string }> {
    try {
      const result = await runCli('claude', ['--version'], {}, 5000)
      if (result.exitCode === 0) {
        return { available: true, version: result.stdout.trim() }
      }
      return { available: false, reason: 'claude CLI 未就绪' }
    } catch {
      return { available: false, reason: 'claude CLI 未找到，请安装 Claude Code CLI' }
    }
  }

  async run(params: RunParams): Promise<RunResult> {
    const start = Date.now()
    ensureOutputDir(params.outputDir)

    const bin = params.agent.bin || 'claude'
    const prompt = buildPrompt(params)

    try {
      const result = await runCli(
        bin,
        ['--print', prompt],
        { CLAUDE_OUTPUT_DIR: params.outputDir },
        60 * 60 * 1000
      )

      // AI: 将 claude 的 stdout 写入 output.md
      const outputFile = path.join(params.outputDir, 'output.md')
      if (result.stdout) {
        fs.writeFileSync(outputFile, result.stdout, 'utf-8')
      }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        outputFiles: result.stdout ? [outputFile] : [],
        error: result.exitCode !== 0 ? result.stderr : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        exitCode: -1,
        outputFiles: [],
        error: String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// ─── Generic CLI Runner ───────────────────────────────────────────────

export class GenericCLIRunner implements Runner {
  readonly id = 'generic-cli'

  async probe(): Promise<{ available: boolean; reason?: string }> {
    return { available: true }
  }

  async run(params: RunParams): Promise<RunResult> {
    const start = Date.now()
    ensureOutputDir(params.outputDir)

    if (!params.agent.bin) {
      return {
        success: false,
        exitCode: -1,
        outputFiles: [],
        error: 'generic-cli runner 需要配置 bin 路径',
        durationMs: Date.now() - start,
      }
    }

    try {
      const result = await runCli(
        params.agent.bin,
        [params.task.title],
        { ARM_TASK_ID: params.task.id, ARM_OUTPUT_DIR: params.outputDir },
        60 * 60 * 1000
      )

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        outputFiles: [],
        error: result.exitCode !== 0 ? result.stderr : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        exitCode: -1,
        outputFiles: [],
        error: String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// ─── CodeFlicker Runner ───────────────────────────────────────────────

export class CodeFlickerRunner implements Runner {
  readonly id = 'codeflicker'

  async probe(): Promise<{ available: boolean; reason?: string; version?: string }> {
    // AI: 检查 cf CLI 是否存在（CodeFlicker CLI）
    try {
      const result = await runCli('cf', ['--version'], {}, 5000)
      if (result.exitCode === 0) {
        return { available: true, version: result.stdout.trim() }
      }
      return { available: false, reason: 'CodeFlicker CLI (cf) 返回非零退出码' }
    } catch {
      return { available: false, reason: 'CodeFlicker CLI (cf) 未找到，请安装 CodeFlicker CLI' }
    }
  }

  async run(params: RunParams): Promise<RunResult> {
    const start = Date.now()
    ensureOutputDir(params.outputDir)

    const bin = params.agent.bin || 'cf'
    const prompt = buildPrompt(params)

    // AI: CodeFlicker CLI 执行方式：cf run --skill <agent.name> --print "<prompt>"
    // 如果 agent 没有指定 skill 名，则直接 cf --print "<prompt>" 进入默认 agent 会话
    const skillName = params.agent.name
    const args = skillName
      ? ['run', '--skill', skillName, '--print', prompt]
      : ['--print', prompt]

    try {
      const result = await runCli(
        bin,
        args,
        { CF_OUTPUT_DIR: params.outputDir },
        60 * 60 * 1000
      )

      // AI: 将输出写入 output.md
      const outputFile = path.join(params.outputDir, 'output.md')
      if (result.stdout) {
        fs.writeFileSync(outputFile, result.stdout, 'utf-8')
      }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        outputFiles: result.stdout ? [outputFile] : [],
        error: result.exitCode !== 0 ? result.stderr : undefined,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        exitCode: -1,
        outputFiles: [],
        error: String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// ─── Runner 注册表 ───────────────────────────────────────────────

const RUNNERS = new Map<string, Runner>([
  ['openclaw', new OpenClawRunner()],
  ['claude-code', new ClaudeCodeRunner()],
  ['codeflicker', new CodeFlickerRunner()],
  ['generic-cli', new GenericCLIRunner()],
])

// AI: 根据 runnerId 获取 Runner 实例
export function getRunner(runnerId: string): Runner | null {
  return RUNNERS.get(runnerId) ?? null
}

// AI: 列出所有 Runner 及其可用状态
export async function probeAllRunners(): Promise<{ id: string; available: boolean; reason?: string; version?: string }[]> {
  const results = await Promise.all(
    Array.from(RUNNERS.values()).map(async (runner) => {
      const probe = await runner.probe()
      return { id: runner.id, ...probe }
    })
  )
  return results
}

// ─── 辅助函数 ───────────────────────────────────────────────

function buildPrompt(params: RunParams): string {
  return [
    `任务ID: ${params.task.id}`,
    `任务标题: ${params.task.title}`,
    params.task.description ? `任务描述: ${params.task.description}` : '',
    `输出目录: ${params.outputDir}`,
    '',
    '请完成以上任务，并将主要输出写入输出目录。',
  ].filter(Boolean).join('\n')
}
/*  end: Runner 层结束 */
