import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ExternalLink, Plus, RefreshCw, SquareTerminal, X } from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'

interface TerminalSession {
  id: string
  workspaceId: string
  conversationId: string
  cwd: string
  name: string
  tty: string
  provider: 'iterm2'
  status: 'running'
}

export function TerminalTab({ workspaceId, conversationId }: SessionSidebarContext) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [command, setCommand] = useState('')
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
      const capabilityResponse = await fetch('/api/workspace-sidebar/terminal/capabilities')
      const capability = await capabilityResponse.json()
      if (!capabilityResponse.ok) throw new Error(capability.error || '无法检查 iTerm2')
      setAvailable(Boolean(capability.available))
      if (!capability.available) {
        setSessions([])
        setActiveId('')
        return
      }

      const query = new URLSearchParams({ workspaceId, conversationId })
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法恢复 iTerm2 终端')
      const nextSessions = data.sessions as TerminalSession[]
      setSessions(nextSessions)
      setActiveId((current) => nextSessions.some((session) => session.id === current)
        ? current
        : (nextSessions[0]?.id ?? ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法恢复 iTerm2 终端')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [conversationId, workspaceId])

  useEffect(() => {
    setSessions([])
    setActiveId('')
    setCommand('')
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
      if (!response.ok) throw new Error(data.error || '无法启动 iTerm2 终端')
      const next = data.session as TerminalSession
      setSessions((current) => [...current.filter((session) => session.id !== next.id), next])
      setActiveId(next.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法启动 iTerm2 终端')
    } finally {
      setCreating(false)
    }
  }

  async function focusSession(session: TerminalSession) {
    setBusyId(session.id)
    setError('')
    try {
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions/${encodeURIComponent(session.id)}/focus`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '无法打开 iTerm2 终端')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法打开 iTerm2 终端')
      await loadSessions(false)
    } finally {
      setBusyId('')
    }
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault()
    const nextCommand = command.trim()
    if (!activeSession || !nextCommand) return
    setCommand('')
    setBusyId(activeSession.id)
    setError('')
    try {
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions/${encodeURIComponent(activeSession.id)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: nextCommand }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '命令发送失败')
      }
    } catch (reason) {
      setCommand(nextCommand)
      setError(reason instanceof Error ? reason.message : '命令发送失败')
      await loadSessions(false)
    } finally {
      setBusyId('')
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
        throw new Error(data.error || '无法关闭 iTerm2 终端')
      }
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setActiveId((current) => current === session.id ? '' : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法关闭 iTerm2 终端')
      await loadSessions(false)
    } finally {
      setBusyId('')
    }
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
  if (loading) return <PanelLoading label="正在发现 iTerm2 终端…" />
  if (error && available === null) {
    return <PanelError message={error} action={<RetryButton onClick={() => void loadSessions()} />} />
  }
  if (available === false) {
    return (
      <PanelEmpty
        title="需要 iTerm2"
        description="未检测到 iTerm2。安装后重新打开此面板，Manta 会在 iTerm2 中创建和恢复真实终端会话。"
        icon={<SquareTerminal size={18} aria-hidden="true" />}
        action={<RetryButton onClick={() => void loadSessions()} />}
      />
    )
  }
  if (!sessions.length) {
    return (
      <PanelEmpty
        title="尚未启动终端"
        description="终端由 iTerm2 持有，支持完整的交互程序；你可以为当前对话同时开启多个终端。"
        icon={<SquareTerminal size={18} aria-hidden="true" />}
        action={(
          <button type="button" className="workspace-panel-button" onClick={() => void createSession()} disabled={creating}>
            <SquareTerminal size={14} aria-hidden="true" />
            {creating ? '正在启动…' : '新建 iTerm2 终端'}
          </button>
        )}
      />
    )
  }

  return (
    <div className="workspace-terminal">
      <div className="workspace-terminal-tabs" role="tablist" aria-label="iTerm2 终端会话">
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
                  title={`${session.name} · ${session.tty}`}
                >
                  <span className="workspace-terminal-dot is-running" aria-hidden="true" />
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
          onClick={() => void createSession()}
          disabled={creating}
          aria-label="新建 iTerm2 终端"
          title="新建终端"
        >
          <Plus size={14} />
        </button>
      </div>

      {error ? <div className="workspace-terminal-warning" role="status">{error}</div> : null}

      {activeSession ? (
        <>
          <div
            id={sessionPanelId(activeSession.id)}
            className="workspace-terminal-summary"
            role="tabpanel"
            aria-labelledby={sessionTabId(activeSession.id)}
          >
            <div className="workspace-terminal-mark" aria-hidden="true"><SquareTerminal size={20} /></div>
            <strong>{activeSession.name}</strong>
            <span title={activeSession.cwd}>{activeSession.cwd}</span>
            <code>{activeSession.tty || 'iTerm2 session'}</code>
            <p>完整终端界面和输出由 iTerm2 承载。你可以在这里发送命令，或打开 iTerm2 继续交互。</p>
            <button
              type="button"
              className="workspace-panel-button"
              onClick={() => void focusSession(activeSession)}
              disabled={busyId === activeSession.id}
            >
              <ExternalLink size={14} />
              在 iTerm2 中打开
            </button>
          </div>
          <form className="workspace-terminal-input" onSubmit={submitCommand}>
            <span aria-hidden="true">❯</span>
            <label className="sr-only" htmlFor={`terminal-command-${activeSession.id}`}>发送命令到 {activeSession.name}</label>
            <input
              id={`terminal-command-${activeSession.id}`}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              disabled={busyId === activeSession.id}
              autoComplete="off"
              spellCheck={false}
              placeholder={`发送命令到${activeSession.name}`}
            />
            <button
              type="button"
              className="workspace-terminal-refresh"
              onClick={() => void loadSessions(false)}
              aria-label="刷新终端列表"
              title="刷新终端列表"
            >
              <RefreshCw size={13} />
            </button>
          </form>
        </>
      ) : null}
    </div>
  )
}

function sessionTabId(id: string): string {
  return `iterm-session-tab-${encodeURIComponent(id)}`
}

function sessionPanelId(id: string): string {
  return `iterm-session-panel-${encodeURIComponent(id)}`
}
