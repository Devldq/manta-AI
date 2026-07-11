import { spawn } from 'node:child_process'

export type PowerShellLauncher = (executable: string, script: string, input?: string, env?: NodeJS.ProcessEnv) => Promise<string>

const launch: PowerShellLauncher = (executable, script, input = '', env) => new Promise((resolve, reject) => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64'); const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value }); child.stderr.setEncoding('utf8').on('data', (value) => { stderr += value }); child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${executable} failed (${code}): ${stderr.trim()}`))); child.stdin.end(input)
})

export class PowerShellResolver {
  private executable?: string
  constructor(private readonly launcher: PowerShellLauncher = launch) {}
  async run(script: string, input = '', env: NodeJS.ProcessEnv = process.env): Promise<string> {
    if (this.executable) return this.launcher(this.executable, script, input, env)
    const missing: string[] = []
    for (const candidate of ['powershell.exe', 'pwsh']) {
      try { const output = await this.launcher(candidate, script, input, env); this.executable = candidate; return output } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missing.push(candidate) }
    }
    throw new Error(`PowerShell executables ${missing.join(' and ')} unavailable (not found)`)
  }
}

export const powershell = new PowerShellResolver()
