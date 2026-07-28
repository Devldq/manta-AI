import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { basename } from 'node:path'

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
  shell: string
  status: WorkspaceTerminalStatus
  createdAt: string
  updatedAt: string
  exitCode?: number | null
  lastSeq: number
}

interface TerminalSession extends WorkspaceTerminalSnapshot {
  process: ChildProcessWithoutNullStreams
  events: WorkspaceTerminalEvent[]
  subscribers: Set<(event: WorkspaceTerminalEvent) => void>
}

const MAX_REPLAY_EVENTS = 2_000

export class WorkspaceTerminalService {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly sessionIdsByScope = new Map<string, string>()

  createOrGet(input: { workspaceId: string; conversationId: string; cwd: string }): WorkspaceTerminalSnapshot {
    const scope = this.scopeKey(input.workspaceId, input.conversationId)
    const currentId = this.sessionIdsByScope.get(scope)
    const current = currentId ? this.sessions.get(currentId) : undefined
    if (current?.status === 'running') return this.snapshot(current)

    const shell = process.platform === 'win32'
      ? (process.env.COMSPEC || 'powershell.exe')
      : (process.env.SHELL || '/bin/sh')
    const args = shellArgs(shell)
    const child = spawn(shell, args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const now = new Date().toISOString()
    const session: TerminalSession = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      cwd: input.cwd,
      shell,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      lastSeq: 0,
      process: child,
      events: [],
      subscribers: new Set(),
    }
    this.sessions.set(session.id, session)
    this.sessionIdsByScope.set(scope, session.id)
    this.publish(session, 'status', `命令会话已连接 · ${input.cwd}\n`)

    child.stdout.on('data', (chunk: Buffer) => this.publish(session, 'output', chunk.toString(), 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => this.publish(session, 'output', chunk.toString(), 'stderr'))
    child.once('error', (error) => {
      session.status = 'failed'
      this.publish(session, 'output', `${error.message}\n`, 'stderr')
    })
    child.once('exit', (code) => {
      session.status = session.status === 'failed' ? 'failed' : 'exited'
      session.exitCode = code
      this.publish(session, 'exit', `命令会话已结束${code == null ? '' : `（退出码 ${code}）`}\n`)
    })

    return this.snapshot(session)
  }

  current(workspaceId: string, conversationId: string): WorkspaceTerminalSnapshot | undefined {
    const id = this.sessionIdsByScope.get(this.scopeKey(workspaceId, conversationId))
    const session = id ? this.sessions.get(id) : undefined
    return session ? this.snapshot(session) : undefined
  }

  get(id: string): WorkspaceTerminalSnapshot | undefined {
    const session = this.sessions.get(id)
    return session ? this.snapshot(session) : undefined
  }

  write(id: string, command: string): WorkspaceTerminalSnapshot {
    const session = this.requireRunning(id)
    const normalized = command.replace(/\r?\n$/, '')
    this.publish(session, 'input', `❯ ${normalized}\n`)
    session.process.stdin.write(`${normalized}\n`)
    return this.snapshot(session)
  }

  close(id: string): WorkspaceTerminalSnapshot {
    const session = this.requireSession(id)
    if (session.status === 'running') {
      session.process.stdin.end('exit\n')
      const forceKill = setTimeout(() => {
        if (session.status === 'running') session.process.kill('SIGTERM')
      }, 1_000)
      forceKill.unref()
    }
    return this.snapshot(session)
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
      if (session.status === 'running') session.process.kill('SIGTERM')
    }
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

function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') {
    return basename(shell).toLowerCase().startsWith('powershell') ? ['-NoLogo', '-NoProfile', '-Command', '-'] : []
  }
  const name = basename(shell)
  if (name === 'zsh') return ['-f']
  if (name === 'bash') return ['--noprofile', '--norc']
  if (name === 'fish') return ['--no-config']
  return []
}
