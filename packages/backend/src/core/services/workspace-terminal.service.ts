import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const RECORD_SEPARATOR = '\u001e'
const FIELD_SEPARATOR = '\u001f'
const ITERM_APP_NAME = 'iTerm'
const ITERM_PROVIDER = 'iterm2' as const

export interface WorkspaceTerminalSnapshot {
  id: string
  workspaceId: string
  conversationId: string
  cwd: string
  name: string
  tty: string
  provider: typeof ITERM_PROVIDER
  status: 'running'
}

export interface WorkspaceTerminalController {
  available(): Promise<boolean>
  list(scopeKey: string): Promise<Array<{ id: string; name: string; tty: string }>>
  create(input: { scopeKey: string; cwd: string; name: string }): Promise<{ id: string; name: string; tty: string }>
  write(id: string, command: string): Promise<void>
  focus(id: string): Promise<void>
  close(id: string): Promise<void>
}

export class WorkspaceTerminalService {
  constructor(private readonly controller: WorkspaceTerminalController = new Iterm2AppleScriptController()) {}

  async availability(): Promise<{ provider: typeof ITERM_PROVIDER; available: boolean }> {
    return { provider: ITERM_PROVIDER, available: await this.controller.available() }
  }

  async list(input: { workspaceId: string; conversationId: string; cwd: string }): Promise<WorkspaceTerminalSnapshot[]> {
    await this.requireAvailable()
    const sessions = await this.controller.list(this.scopeKey(input.workspaceId, input.conversationId))
    return sessions.map((session) => this.snapshot(input, session))
  }

  async create(input: { workspaceId: string; conversationId: string; cwd: string }): Promise<WorkspaceTerminalSnapshot> {
    await this.requireAvailable()
    const existing = await this.controller.list(this.scopeKey(input.workspaceId, input.conversationId))
    const usedNumbers = new Set(existing.map((session) => terminalNumber(session.name)).filter((value) => value > 0))
    let nextNumber = 1
    while (usedNumbers.has(nextNumber)) nextNumber += 1
    const session = await this.controller.create({
      scopeKey: this.scopeKey(input.workspaceId, input.conversationId),
      cwd: input.cwd,
      name: `终端 ${nextNumber}`,
    })
    return this.snapshot(input, session)
  }

  async write(id: string, command: string): Promise<void> {
    await this.requireAvailable()
    await this.controller.write(id, command.replace(/\r?\n$/, ''))
  }

  async focus(id: string): Promise<void> {
    await this.requireAvailable()
    await this.controller.focus(id)
  }

  async close(id: string): Promise<void> {
    await this.requireAvailable()
    await this.controller.close(id)
  }

  private snapshot(
    input: { workspaceId: string; conversationId: string; cwd: string },
    session: { id: string; name: string; tty: string },
  ): WorkspaceTerminalSnapshot {
    return {
      ...session,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      cwd: input.cwd,
      provider: ITERM_PROVIDER,
      status: 'running',
    }
  }

  private async requireAvailable(): Promise<void> {
    if (!await this.controller.available()) {
      throw Object.assign(new Error('未检测到 iTerm2，请先安装并启动 iTerm2'), { statusCode: 503 })
    }
  }

  private scopeKey(workspaceId: string, conversationId: string): string {
    return `${workspaceId}:${conversationId}`
  }
}

class Iterm2AppleScriptController implements WorkspaceTerminalController {
  async available(): Promise<boolean> {
    if (process.platform !== 'darwin') return false
    try {
      await execFileAsync('/usr/bin/open', ['-Ra', ITERM_APP_NAME], { timeout: 2_000 })
      return true
    } catch {
      return false
    }
  }

  async list(scopeKey: string): Promise<Array<{ id: string; name: string; tty: string }>> {
    const output = await runAppleScript(LIST_SESSIONS_SCRIPT, [scopeKey])
    return output
      .split(RECORD_SEPARATOR)
      .filter(Boolean)
      .map((record) => {
        const [id, name, tty] = record.split(FIELD_SEPARATOR)
        return { id, name, tty }
      })
      .filter((session) => session.id)
  }

  async create(input: { scopeKey: string; cwd: string; name: string }): Promise<{ id: string; name: string; tty: string }> {
    const output = await runAppleScript(CREATE_SESSION_SCRIPT, [
      input.scopeKey,
      input.cwd,
      input.name,
      `cd -- ${quoteShellArgument(input.cwd)}`,
    ])
    const [id, name, tty] = output.split(FIELD_SEPARATOR)
    if (!id) throw new Error('iTerm2 未返回新会话标识')
    return { id, name: name || input.name, tty: tty || '' }
  }

  async write(id: string, command: string): Promise<void> {
    await runAppleScript(SESSION_ACTION_SCRIPT, [id, 'write', command])
  }

  async focus(id: string): Promise<void> {
    await runAppleScript(SESSION_ACTION_SCRIPT, [id, 'focus', ''])
  }

  async close(id: string): Promise<void> {
    await runAppleScript(SESSION_ACTION_SCRIPT, [id, 'close', ''])
  }
}

async function runAppleScript(script: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script, '--', ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1_000_000,
    })
    return stdout.trim()
  } catch (reason) {
    const error = reason as Error & { stderr?: string }
    const detail = error.stderr?.trim() || error.message
    if (/not authorized|not permitted|automation/i.test(detail)) {
      throw Object.assign(new Error('Manta 没有控制 iTerm2 的自动化权限，请在系统设置中允许后重试'), { statusCode: 503 })
    }
    if (/MANTA_SESSION_NOT_FOUND/.test(detail)) {
      throw Object.assign(new Error('iTerm2 终端会话已不存在'), { statusCode: 404 })
    }
    throw new Error(`iTerm2 操作失败：${detail}`)
  }
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function terminalNumber(name: string): number {
  const match = /^终端\s+(\d+)$/.exec(name)
  return match ? Number.parseInt(match[1], 10) : 0
}

const LIST_SESSIONS_SCRIPT = String.raw`
on run argv
  set targetScope to item 1 of argv
  set recordSeparator to ASCII character 30
  set fieldSeparator to ASCII character 31
  set resultText to ""
  tell application "iTerm2"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aSession in sessions of aTab
          try
            set mantaScope to variable named "user.mantaScope" of aSession
            if mantaScope is targetScope then
              set mantaName to variable named "user.mantaName" of aSession
              set resultText to resultText & (unique id of aSession) & fieldSeparator & mantaName & fieldSeparator & (tty of aSession) & recordSeparator
            end if
          end try
        end repeat
      end repeat
    end repeat
  end tell
  return resultText
end run`

const CREATE_SESSION_SCRIPT = String.raw`
on run argv
  set targetScope to item 1 of argv
  set targetDirectory to item 2 of argv
  set targetName to item 3 of argv
  set changeDirectoryCommand to item 4 of argv
  set fieldSeparator to ASCII character 31
  tell application "iTerm2"
    activate
    if (count of windows) is 0 then
      set targetWindow to (create window with default profile)
      set targetSession to current session of current tab of targetWindow
    else
      set targetWindow to current window
      tell targetWindow
        set targetTab to (create tab with default profile)
        set targetSession to current session of targetTab
      end tell
    end if
    tell targetSession
      set variable named "user.mantaScope" to targetScope
      set variable named "user.mantaName" to targetName
      set variable named "user.mantaDirectory" to targetDirectory
      write text changeDirectoryCommand
      return (unique id) & fieldSeparator & targetName & fieldSeparator & tty
    end tell
  end tell
end run`

const SESSION_ACTION_SCRIPT = String.raw`
on run argv
  set targetId to item 1 of argv
  set targetAction to item 2 of argv
  set targetText to item 3 of argv
  tell application "iTerm2"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aSession in sessions of aTab
          if (unique id of aSession) is targetId then
            if targetAction is "write" then
              tell aSession to write text targetText
            else if targetAction is "focus" then
              tell aSession to select
              tell aTab to select
              tell aWindow to select
              activate
            else if targetAction is "close" then
              tell aSession to close
            end if
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "MANTA_SESSION_NOT_FOUND"
end run`
