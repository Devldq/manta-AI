/*  start: Runner 层 — openclaw runner 实现 */
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
// logFile 可选：若指定，每收到 chunk 立即 append 写入（实时日志）
function runCli(
  bin: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
  cwd?: string,
  logFile?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      // AI: 若指定了工作目录，在该目录下运行 CLI
      ...(cwd ? { cwd } : {}),
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stdout += chunk
      // AI: 实时追加写入日志文件（前端可轮询读取）
      if (logFile) {
        try { fs.appendFileSync(logFile, chunk) } catch { /* ignore */ }
      }
    })
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      // AI: stderr 加 [ERR] 前缀写入同一日志文件
      if (logFile) {
        try { fs.appendFileSync(logFile, `[ERR] ${chunk}`) } catch { /* ignore */ }
      }
    })

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

    const bin = params.agent.bin || 'openclaw'
    const agentId = params.agent.name
    const message = buildPrompt(params)

    // AI: 工作流模式下需要同步等待 openclaw 进程完成，才能推进到下一步骤
    // 不再使用 detached + unref（fire-and-forget），改为等待子进程退出
    // AI: runner.log 用于前端实时轮询展示执行日志
    const logFile = path.join(params.outputDir, 'runner.log')
    try {
      const result = await runCli(
        bin,
        ['agent', '--agent', agentId, '--message', message],
        { PATH: `${path.join(os.homedir(), '.openclaw', 'bin')}:${process.env.PATH ?? ''}` },
        60 * 60 * 1000, // AI: 最长等待 1 小时
        undefined,
        logFile,
      )

      console.log(`[Manta] openclaw agent ${agentId} 已完成 (exitCode: ${result.exitCode})`)

      // AI: 将 stdout 写入 output.md（如有输出）
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
  // AI: 对齐 v1 buildTriggerMessage — 包含完整任务上下文给 agent
  const lines = [
    `任务ID: ${params.task.id}`,
    `任务标题: ${params.task.title}`,
    params.task.description ? `任务描述: ${params.task.description}` : null,
    // AI: 若指定了工作目录，提示 Agent 在该目录下操作文件
    params.task.workDir ? `工作目录: ${params.task.workDir}` : null,
    `\n新任务已创建，请按工作循环开始执行。`,
  ].filter(Boolean) as string[]
  return lines.join('\n')
}
/*  end: Runner 层结束 */
