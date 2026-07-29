import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Plus, RefreshCw, SquareTerminal, X } from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'

interface TerminalSession {
  id: string
  workspaceId: string
  conversationId: string
  cwd: string
  name: string
  shell: string
  provider: 'system-shell'
  status: 'running' | 'exited' | 'failed'
  lastSeq: number
  cols: number
  rows: number
}

interface TerminalSocketEvent {
  type: 'ready' | 'status' | 'output' | 'exit'
  seq?: number
  data?: string
}

export function TerminalTab({ workspaceId, conversationId }: SessionSidebarContext) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null,
    [activeId, sessions],
  )

  const loadSessions = useCallback(async (showLoading = true) => {
    if (!workspaceId || !conversationId) return
    if (showLoading) setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ workspaceId, conversationId })
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法恢复终端会话')
      const nextSessions = data.sessions as TerminalSession[]
      setSessions(nextSessions)
      setActiveId((current) => nextSessions.some((session) => session.id === current)
        ? current
        : (nextSessions[0]?.id ?? ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法恢复终端会话')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [conversationId, workspaceId])

  useEffect(() => {
    setSessions([])
    setActiveId('')
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadSessions(false)
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
  }, [loadSessions])

  async function createSession() {
    if (!workspaceId || !conversationId) return
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/workspace-sidebar/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, conversationId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法启动终端')
      const next = data.session as TerminalSession
      setSessions((current) => [...current.filter((session) => session.id !== next.id), next])
      setActiveId(next.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法启动终端')
    } finally {
      setCreating(false)
    }
  }

  async function closeSession(session: TerminalSession) {
    setBusyId(session.id)
    setError('')
    try {
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '无法关闭终端')
      }
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setActiveId((current) => current === session.id ? '' : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法关闭终端')
      await loadSessions(false)
    } finally {
      setBusyId('')
    }
  }

  function handleSessionExit(sessionId: string) {
    setSessions((current) => current.map((session) => session.id === sessionId
      ? { ...session, status: 'exited' }
      : session))
  }

  function handleSessionTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, sessionIndex: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (sessionIndex + 1) % sessions.length
    if (event.key === 'ArrowLeft') nextIndex = (sessionIndex - 1 + sessions.length) % sessions.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = sessions.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const nextSession = sessions[nextIndex]
    setActiveId(nextSession.id)
    document.getElementById(sessionTabId(nextSession.id))?.focus()
  }

  if (!workspaceId || !conversationId) {
    return (
      <PanelEmpty
        title="终端不可用"
        description="终端必须绑定到一个工作区对话，避免命令运行到错误目录。"
        icon={<SquareTerminal size={18} aria-hidden="true" />}
      />
    )
  }
  if (loading) return <PanelLoading label="正在恢复终端会话…" />
  if (error && !sessions.length) {
    return <PanelError message={error} action={<RetryButton onClick={() => void loadSessions()} />} />
  }
  if (!sessions.length) {
    return (
      <PanelEmpty
        title="尚未启动终端"
        description="Manta 内置交互式终端使用系统默认 Shell，支持快捷键、补全和终端程序。"
        icon={<SquareTerminal size={18} aria-hidden="true" />}
        action={(
          <button type="button" className="workspace-panel-button" onClick={() => void createSession()} disabled={creating}>
            <SquareTerminal size={14} aria-hidden="true" />
            {creating ? '正在启动…' : '新建终端'}
          </button>
        )}
      />
    )
  }

  return (
    <div className="workspace-terminal">
      <div className="workspace-terminal-tabs" role="tablist" aria-label="终端会话">
        <div className="workspace-terminal-tabs-scroll">
          {sessions.map((session, sessionIndex) => {
            const selected = session.id === activeSession?.id
            return (
              <div key={session.id} className={`workspace-terminal-tab${selected ? ' is-active' : ''}`}>
                <button
                  id={sessionTabId(session.id)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={sessionPanelId(session.id)}
                  tabIndex={selected ? 0 : -1}
                  className="workspace-terminal-tab-select"
                  onClick={() => setActiveId(session.id)}
                  onKeyDown={(event) => handleSessionTabKeyDown(event, sessionIndex)}
                  title={`${session.name} · ${session.cwd}`}
                >
                  <span className={`workspace-terminal-dot is-${session.status}`} aria-hidden="true" />
                  <span>{session.name}</span>
                </button>
                <button
                  type="button"
                  className="workspace-terminal-tab-close"
                  onClick={() => void closeSession(session)}
                  disabled={busyId === session.id}
                  aria-label={`关闭${session.name}`}
                  title="关闭终端"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="workspace-terminal-tab-action"
          onClick={() => void loadSessions(false)}
          aria-label="刷新终端列表"
          title="刷新终端列表"
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          className="workspace-terminal-tab-action"
          onClick={() => void createSession()}
          disabled={creating}
          aria-label="新建终端"
          title="新建终端"
        >
          <Plus size={14} />
        </button>
      </div>

      {error ? <div className="workspace-terminal-warning" role="status">{error}</div> : null}

      <div className="workspace-terminal-canvases">
        {sessions.map((session) => (
          <TerminalViewport
            key={session.id}
            session={session}
            active={session.id === activeSession?.id}
            onExit={() => handleSessionExit(session.id)}
            onConnectionError={setError}
          />
        ))}
      </div>
    </div>
  )
}

function TerminalViewport({
  session,
  active,
  onExit,
  onConnectionError,
}: {
  session: TerminalSession
  active: boolean
  onExit(): void
  onConnectionError(message: string): void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const activeRef = useRef(active)
  const exitedRef = useRef(session.status !== 'running')
  const lastSeqRef = useRef(0)
  const onExitRef = useRef(onExit)
  const onConnectionErrorRef = useRef(onConnectionError)

  activeRef.current = active
  onExitRef.current = onExit
  onConnectionErrorRef.current = onConnectionError

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!active || !terminal || !fitAddon) return
    requestAnimationFrame(() => {
      fitAddon.fit()
      sendResize(socketRef.current, terminal)
      terminal.focus()
    })
  }, [active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const styles = getComputedStyle(document.documentElement)
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: styles.getPropertyValue('--font-mono').trim() || 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11,
      lineHeight: 1.35,
      scrollback: 10_000,
      screenReaderMode: true,
      theme: {
        background: readColor(styles, '--color-background', '#0b0c10'),
        foreground: readColor(styles, '--color-text-primary', '#e7e7ea'),
        cursor: readColor(styles, '--color-accent', '#c77dff'),
        selectionBackground: readColor(styles, '--color-accent-subtle', '#40304d'),
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (disposed || exitedRef.current) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const path = `/api/workspace-sidebar/terminal/sessions/${encodeURIComponent(session.id)}/socket`
      const socket = new WebSocket(`${protocol}//${window.location.host}${path}?afterSeq=${lastSeqRef.current}`)
      socketRef.current = socket
      socket.onopen = () => {
        onConnectionErrorRef.current('')
        if (activeRef.current) {
          fitAddon.fit()
          sendResize(socket, terminal)
          terminal.focus()
        }
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as TerminalSocketEvent
        if (typeof message.seq === 'number') lastSeqRef.current = Math.max(lastSeqRef.current, message.seq)
        if (message.data) terminal.write(message.data)
        if (message.type === 'exit') {
          exitedRef.current = true
          terminal.options.disableStdin = true
          onExitRef.current()
        }
      }
      socket.onclose = () => {
        if (disposed || exitedRef.current) return
        onConnectionErrorRef.current('终端连接已中断，正在自动重连…')
        reconnectTimer = setTimeout(connect, 1_000)
      }
      socket.onerror = () => socket.close()
    }

    const input = terminal.onData((data) => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) return
      fitAddon.fit()
      sendResize(socketRef.current, terminal)
    })
    resizeObserver.observe(container)
    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      resizeObserver.disconnect()
      input.dispose()
      socketRef.current?.close()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [session.id])

  return (
    <div
      id={sessionPanelId(session.id)}
      ref={containerRef}
      className={`workspace-terminal-canvas${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby={sessionTabId(session.id)}
      aria-hidden={!active}
    />
  )
}

function sendResize(socket: WebSocket | null, terminal: Terminal) {
  if (socket?.readyState !== WebSocket.OPEN || terminal.cols < 2 || terminal.rows < 1) return
  socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
}

function readColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

function sessionTabId(id: string): string {
  return `terminal-session-tab-${encodeURIComponent(id)}`
}

function sessionPanelId(id: string): string {
  return `terminal-session-panel-${encodeURIComponent(id)}`
}
