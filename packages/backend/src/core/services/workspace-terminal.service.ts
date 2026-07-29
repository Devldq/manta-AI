import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import * as pty from '@lydell/node-pty'

export type WorkspaceTerminalStatus = 'running' | 'exited' | 'failed'
export type WorkspaceTerminalEventType = 'status' | 'input' | 'output' | 'exit'

export interface WorkspaceTerminalEvent {
  seq: number
  type: WorkspaceTerminalEventType
  data: string
  stream?: 'stdout' | 'stderr'
  timestamp: string
}

export interface WorkspaceTerminalSnapshot {
  id: string
  workspaceId: string
  conversationId: string
  cwd: string
  name: string
  shell: string
  provider: 'system-shell'
  status: WorkspaceTerminalStatus
  createdAt: string
  updatedAt: string
  exitCode?: number | null
  lastSeq: number
  cols: number
  rows: number
}

interface TerminalSession extends WorkspaceTerminalSnapshot {
  process: pty.IPty
  events: WorkspaceTerminalEvent[]
  subscribers: Set<(event: WorkspaceTerminalEvent) => void>
}

const MAX_REPLAY_EVENTS = 2_000

export class WorkspaceTerminalService {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly sessionIdsByScope = new Map<string, Set<string>>()

  list(workspaceId: string, conversationId: string): WorkspaceTerminalSnapshot[] {
    const ids = this.sessionIdsByScope.get(this.scopeKey(workspaceId, conversationId))
    if (!ids) return []
    return [...ids]
      .map((id) => this.sessions.get(id))
      .filter((session): session is TerminalSession => Boolean(session))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => this.snapshot(session))
  }

  create(input: { workspaceId: string; conversationId: string; cwd: string }): WorkspaceTerminalSnapshot {
    const existing = this.list(input.workspaceId, input.conversationId)
    const usedNumbers = new Set(existing.map((session) => terminalNumber(session.name)).filter((value) => value > 0))
    let nextNumber = 1
    while (usedNumbers.has(nextNumber)) nextNumber += 1

    const shell = systemShell()
    const child = pty.spawn(shell, shellArgs(shell), {
      cwd: input.cwd,
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      env: stringEnvironment({
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        COLORTERM: 'truecolor',
      }),
    })
    const now = new Date().toISOString()
    const session: TerminalSession = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      cwd: input.cwd,
      name: `终端 ${nextNumber}`,
      shell,
      provider: 'system-shell',
      status: 'running',
      createdAt: now,
      updatedAt: now,
      lastSeq: 0,
      cols: 100,
      rows: 30,
      process: child,
      events: [],
      subscribers: new Set(),
    }
    this.sessions.set(session.id, session)
    const scope = this.scopeKey(input.workspaceId, input.conversationId)
    const ids = this.sessionIdsByScope.get(scope) ?? new Set<string>()
    ids.add(session.id)
    this.sessionIdsByScope.set(scope, ids)
    this.publish(session, 'status', `${session.name} · ${basename(shell)} · ${input.cwd}\n`)

    child.onData((data) => this.publish(session, 'output', data, 'stdout'))
    child.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
      this.publish(session, 'exit', `\r\n进程已结束（退出码 ${exitCode}）\r\n`)
    })

    return this.snapshot(session)
  }

  get(id: string): WorkspaceTerminalSnapshot | undefined {
    const session = this.sessions.get(id)
    return session ? this.snapshot(session) : undefined
  }

  write(id: string, data: string): WorkspaceTerminalSnapshot {
    const session = this.requireRunning(id)
    session.process.write(data)
    return this.snapshot(session)
  }

  resize(id: string, cols: number, rows: number): WorkspaceTerminalSnapshot {
    const session = this.requireRunning(id)
    const safeCols = Math.max(2, Math.min(500, Math.floor(cols)))
    const safeRows = Math.max(1, Math.min(300, Math.floor(rows)))
    session.process.resize(safeCols, safeRows)
    session.cols = safeCols
    session.rows = safeRows
    session.updatedAt = new Date().toISOString()
    return this.snapshot(session)
  }

  close(id: string): void {
    const session = this.requireSession(id)
    this.sessions.delete(id)
    const scope = this.scopeKey(session.workspaceId, session.conversationId)
    const ids = this.sessionIdsByScope.get(scope)
    ids?.delete(id)
    if (!ids?.size) this.sessionIdsByScope.delete(scope)
    if (session.status === 'running') {
      session.process.kill()
    }
  }

  events(id: string, afterSeq = 0): WorkspaceTerminalEvent[] {
    return this.requireSession(id).events.filter((event) => event.seq > afterSeq)
  }

  subscribe(id: string, listener: (event: WorkspaceTerminalEvent) => void): () => void {
    const session = this.requireSession(id)
    session.subscribers.add(listener)
    return () => session.subscribers.delete(listener)
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'running') session.process.kill()
    }
    this.sessions.clear()
    this.sessionIdsByScope.clear()
  }

  private publish(
    session: TerminalSession,
    type: WorkspaceTerminalEventType,
    data: string,
    stream?: 'stdout' | 'stderr',
  ): void {
    session.lastSeq += 1
    session.updatedAt = new Date().toISOString()
    const event: WorkspaceTerminalEvent = {
      seq: session.lastSeq,
      type,
      data,
      ...(stream ? { stream } : {}),
      timestamp: session.updatedAt,
    }
    session.events.push(event)
    if (session.events.length > MAX_REPLAY_EVENTS) {
      session.events.splice(0, session.events.length - MAX_REPLAY_EVENTS)
    }
    for (const listener of session.subscribers) listener(event)
  }

  private snapshot(session: TerminalSession): WorkspaceTerminalSnapshot {
    const { process: _process, events: _events, subscribers: _subscribers, ...snapshot } = session
    return snapshot
  }

  private requireSession(id: string): TerminalSession {
    const session = this.sessions.get(id)
    if (!session) throw Object.assign(new Error('终端会话不存在'), { statusCode: 404 })
    return session
  }

  private requireRunning(id: string): TerminalSession {
    const session = this.requireSession(id)
    if (session.status !== 'running') {
      throw Object.assign(new Error('终端会话已结束'), { statusCode: 409 })
    }
    return session
  }

  private scopeKey(workspaceId: string, conversationId: string): string {
    return `${workspaceId}:${conversationId}`
  }
}

function systemShell(): string {
  return process.platform === 'win32'
    ? (process.env.COMSPEC || 'powershell.exe')
    : (process.env.SHELL || '/bin/sh')
}

function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') {
    return basename(shell).toLowerCase().startsWith('powershell') ? ['-NoLogo', '-NoProfile', '-Command', '-'] : []
  }
  const name = basename(shell)
  if (name === 'zsh' || name === 'fish') return ['-l']
  if (name === 'bash') return ['--login']
  return []
}

function terminalNumber(name: string): number {
  const match = /^终端\s+(\d+)$/.exec(name)
  return match ? Number.parseInt(match[1], 10) : 0
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
