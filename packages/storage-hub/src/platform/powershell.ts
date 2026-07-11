import { spawn } from 'node:child_process'

export type PowerShellLauncher = (executable: string, script: string, input?: string, env?: NodeJS.ProcessEnv) => Promise<string>

export function createPowerShellLauncher(spawnProcess: typeof spawn = spawn): PowerShellLauncher {
  return (executable, script, input = '', env) => new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64'); const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''; let stderr = ''; let settled = false
    const fail = (error: unknown) => { if (settled) return; settled = true; reject(error instanceof Error ? error : new Error(String(error))) }
    const finish = (code: number | null) => { if (settled) return; settled = true; if (code === 0) resolve(stdout.replace(/^\uFEFF/, '').trim()); else reject(new Error(`${executable} failed (${code}): ${stderr.trim()}`)) }
    child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value }).on('error', fail); child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value }).on('error', fail); child.stdin.on('error', fail); child.once('error', fail); child.once('close', finish)
    try { child.stdin.end(input, 'utf8', (error?: Error | null) => { if (error) fail(error) }) } catch (error) { fail(error) }
  })
}

const launch = createPowerShellLauncher()
const utf8Prefix = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); [Console]::InputEncoding = [Console]::OutputEncoding; `

export class PowerShellResolver {
  private executable?: string
  constructor(private readonly launcher: PowerShellLauncher = launch) {}
  async run(script: string, input = '', env: NodeJS.ProcessEnv = process.env): Promise<string> {
    if (this.executable) return this.launcher(this.executable, `${utf8Prefix}${script}`, input, env)
    const missing: string[] = []
    for (const candidate of ['powershell.exe', 'pwsh']) {
      try { const output = await this.launcher(candidate, `${utf8Prefix}${script}`, input, env); this.executable = candidate; return output } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missing.push(candidate) }
    }
    throw new Error(`PowerShell executables ${missing.join(' and ')} unavailable (not found)`)
  }
}

export const powershell = new PowerShellResolver()
