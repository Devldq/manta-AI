/* Runner 层 — 通用 Runner 接口与注册表 */
import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'
import type { Runner, RunParams, RunResult } from '../../types'

// ─── 工具函数 ───────────────────────────────────────────────

function ensureOutputDir(outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
}

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
      ...(cwd ? { cwd } : {}),
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stdout += chunk
      if (logFile) {
        try { fs.appendFileSync(logFile, chunk) } catch { /* ignore */ }
      }
    })
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
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

// ─── Runner 注册表 ───────────────────────────────────────────────

const RUNNERS = new Map<string, Runner>()

// 获取 Runner 实例
export function getRunner(runnerId: string): Runner | null {
  return RUNNERS.get(runnerId) ?? null
}

// 注册 Runner 实例
export function registerRunner(runner: Runner): void {
  RUNNERS.set(runner.id, runner)
}

// 列出所有 Runner 及其可用状态
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

export function buildPrompt(params: RunParams): string {
  if (params.task.hidden) {
    return params.task.description || params.task.title
  }

  const lines = [
    `任务ID: ${params.task.id}`,
    `任务标题: ${params.task.title}`,
    params.task.description ? `任务描述: ${params.task.description}` : null,
    params.task.workDir ? `工作目录: ${params.task.workDir}` : null,
    `\n新任务已创建，请按工作循环开始执行。`,
  ].filter(Boolean) as string[]
  return lines.join('\n')
}
