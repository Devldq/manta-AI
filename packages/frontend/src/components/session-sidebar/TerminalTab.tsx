import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Power, SquareTerminal } from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'

interface TerminalSession {
  id: string
  workspaceId: string
  conversationId: string
  cwd: string
  shell: string
  status: 'running' | 'exited' | 'failed'
  lastSeq: number
}

interface TerminalEvent {
  seq: number
  type: 'status' | 'input' | 'output' | 'exit'
  data: string
}

const MAX_OUTPUT_CHARS = 300_000

export function TerminalTab({ workspaceId, conversationId }: SessionSidebarContext) {
  const [session, setSession] = useState<TerminalSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('')
  const outputRef = useRef<HTMLPreElement>(null)

  const loadCurrent = useCallback(async () => {
    if (!workspaceId || !conversationId) return
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ workspaceId, conversationId })
      const response = await fetch(`/api/workspace-sidebar/terminal/current?${query}`)
      if (response.status === 404) {
        setSession(null)
        setOutput('')
        return
      }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法恢复终端会话')
      setSession(data.session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法恢复终端会话')
    } finally {
      setLoading(false)
    }
  }, [conversationId, workspaceId])

  useEffect(() => {
    void loadCurrent()
  }, [loadCurrent])

  useEffect(() => {
    if (!session) return
    setOutput('')
    const source = new EventSource(`/api/workspace-sidebar/terminal/sessions/${session.id}/events?afterSeq=0`)
    const handleEvent = (event: Event) => {
      const message = event as MessageEvent<string>
      const terminalEvent = JSON.parse(message.data) as TerminalEvent
      setOutput((current) => `${current}${terminalEvent.data}`.slice(-MAX_OUTPUT_CHARS))
      if (terminalEvent.type === 'exit') {
        setSession((current) => current ? { ...current, status: 'exited', lastSeq: terminalEvent.seq } : current)
      }
    }
    for (const type of ['status', 'input', 'output', 'exit']) source.addEventListener(type, handleEvent)
    source.onerror = () => setError('终端连接已中断，正在自动重连…')
    source.onopen = () => setError('')
    return () => source.close()
  }, [session?.id])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [output])

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
      if (!response.ok) throw new Error(data.error || '无法启动终端会话')
      setSession(data.session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法启动终端会话')
    } finally {
      setCreating(false)
    }
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault()
    const nextCommand = command.trim()
    if (!session || session.status !== 'running' || !nextCommand) return
    setCommand('')
    try {
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: nextCommand }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '命令发送失败')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '命令发送失败')
    }
  }

  async function closeSession() {
    if (!session) return
    try {
      const response = await fetch(`/api/workspace-sidebar/terminal/sessions/${session.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法关闭终端会话')
      setSession((current) => current ? { ...current, status: 'exited' } : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法关闭终端会话')
    }
  }

  if (!workspaceId || !conversationId) {
    return <PanelEmpty title="终端不可用" description="终端必须绑定到一个工作区对话，避免命令运行到错误目录。" />
  }
  if (loading) return <PanelLoading label="正在恢复终端会话…" />
  if (error && !session) return <PanelError message={error} action={<RetryButton onClick={() => void loadCurrent()} />} />
  if (!session) {
    return (
      <PanelEmpty
        title="尚未启动终端"
        description="命令会话由本地 Service 持有，切换 Tab 或关闭侧边栏后仍可恢复；全屏交互式程序暂不支持。"
        action={(
          <button type="button" className="workspace-panel-button" onClick={() => void createSession()} disabled={creating}>
            <SquareTerminal size={14} aria-hidden="true" />
            {creating ? '正在启动…' : '启动终端'}
          </button>
        )}
      />
    )
  }

  return (
    <div className="workspace-terminal">
      <div className="workspace-panel-toolbar">
        <div className="workspace-panel-toolbar-copy">
          <strong>
            <span className={`workspace-terminal-dot is-${session.status}`} aria-hidden="true" />
            {session.status === 'running' ? '命令会话运行中' : '命令会话已结束'}
          </strong>
          <span title={session.cwd}>{session.cwd}</span>
        </div>
        {session.status === 'running' ? (
          <button type="button" className="workspace-icon-button" onClick={() => void closeSession()} aria-label="结束终端会话" title="结束会话">
            <Power size={14} />
          </button>
        ) : null}
      </div>
      {error ? <div className="workspace-terminal-warning" role="status">{error}</div> : null}
      <pre ref={outputRef} className="workspace-terminal-output" role="log" aria-label="终端输出" tabIndex={0}>
        <code>{output || '等待命令…\n'}</code>
      </pre>
      <form className="workspace-terminal-input" onSubmit={submitCommand}>
        <span aria-hidden="true">❯</span>
        <label className="sr-only" htmlFor={`terminal-command-${session.id}`}>终端命令</label>
        <input
          id={`terminal-command-${session.id}`}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          disabled={session.status !== 'running'}
          autoComplete="off"
          spellCheck={false}
          placeholder={session.status === 'running' ? '输入命令并回车' : '会话已结束'}
        />
      </form>
    </div>
  )
}
