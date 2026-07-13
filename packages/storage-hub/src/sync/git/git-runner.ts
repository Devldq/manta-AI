import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitCapability, GitCommandOptions, GitCommandResult } from './types'

type ExecFile = (file: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number }) => Promise<GitCommandResult>
const nativeExecFile = promisify(execFileCallback) as unknown as ExecFile

function environment(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides, GIT_TERMINAL_PROMPT: '0' }
}

/** Removes credential-shaped values before an error can cross a trust boundary. */
export function redactGitText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
}

export class GitRunner {
  private readonly execute: ExecFile
  private readonly binary: string

  constructor(options: { execFile?: ExecFile; binary?: string } = {}) {
    this.execute = options.execFile ?? nativeExecFile
    this.binary = options.binary ?? 'git'
  }

  async capability(): Promise<GitCapability> {
    try {
      const { stdout } = await this.execute(this.binary, ['--version'], { env: environment() })
      const version = /^git version\s+(\d+\.\d+(?:\.\d+)?)/m.exec(stdout)?.[1]
      return version ? { available: true, version } : { available: false, reason: 'Git returned an unrecognized version' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, reason: 'Git executable was not found' }
      return { available: false, reason: redactGitText((error as Error).message || 'Git is unavailable') }
    }
  }

  async exec(args: readonly string[], options: GitCommandOptions = {}): Promise<GitCommandResult> {
    try {
      return await this.execute(this.binary, args, { cwd: options.cwd, env: environment(options.env), maxBuffer: 16 * 1024 * 1024 })
    } catch (error) {
      throw new Error(redactGitText((error as Error).message || 'Git command failed'))
    }
  }
}
