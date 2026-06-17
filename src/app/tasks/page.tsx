/* 会话聊天页面 — 性能优化版 */
'use client'

import { useState, useEffect, useRef, Suspense, useCallback } from 'react'
import { AlertCircle, Loader2, PanelRight, ArrowLeft } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { SessionSidebar } from '@/app/components/SessionSidebar'
import { useReconnectSSE } from '@/app/hooks/useReconnectSSE'
import { SkeletonChatPage } from '@/app/components/skeleton'
import {
  MessageRow,
  FsAccessBanner,
  WelcomeScreen,
  CapabilityTags,
  KimInputBar,
} from './components'
import type { Conversation, AgentEntry } from './utils'

const DEFAULT_AGENT = 'main'

// ─── ChatView（有会话时） ─────────────────────────────────────────────────────

function ChatView({
  convId, agentName, initialMessages, onAgentChange, onNewChat, title, agents, conversation, workspaceId,
}: {
  convId: string; agentName: string; initialMessages: UIMessage[]
  onAgentChange: (name: string) => void; onNewChat: () => void; title: string; agents: AgentEntry[]
  conversation: Conversation | null
  workspaceId?: string | null
}) {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [inputText, setInputText] = useState('')

  // 构建 API URL 的辅助函数，自动添加 workspace 参数
  const buildConvUrl = useCallback((path: string = '') => {
    const typeParam = workspaceId ? 'type=workspace' : ''
    const wsParam = workspaceId ? `workspaceId=${workspaceId}` : ''
    const params = [typeParam, wsParam].filter(Boolean).join('&')
    return `/api/conversations/${convId}${path}${params ? `?${params}` : ''}`
  }, [convId, workspaceId])

  // 本地 conversation 状态
  const [sidebarConv, setSidebarConv] = useState<Conversation | null>(conversation)
  useEffect(() => { setSidebarConv(conversation) }, [conversation])

  // 会话标题编辑状态
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(title)
  const titleInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setTitleValue(title) }, [title])

  // 保存标题
  const handleSaveTitle = useCallback(async () => {
    const trimmed = titleValue.trim()
    if (!trimmed || trimmed === title) {
      setEditingTitle(false)
      setTitleValue(title)
      return
    }
    try {
      const res = await fetch(buildConvUrl(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (res.ok) {
        setSidebarConv((prev) => (prev ? { ...prev, title: trimmed } : prev))
      }
    } catch {
      // 忽略错误
    }
    setEditingTitle(false)
  }, [titleValue, title, buildConvUrl])

  // 编辑模式下聚焦输入框
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const SIDEBAR_OPEN_KEY = 'manta:session-sidebar-open'
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY)
      return saved === 'true'
    }
    return false
  })
  const pendingMsgKey = `manta:pending-msg:${convId}`

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: workspaceId
        ? `/api/conversations/${convId}/ai-stream?type=workspace&workspaceId=${workspaceId}`
        : `/api/conversations/${convId}/ai-stream`,
      body: { agentName },
    }),
    messages: initialMessages,
    id: convId,
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // ─── SSE 重连 ─────────────────────────────────────────────────────────
  const reconnect = useReconnectSSE(convId, !isLoading && status === 'ready', workspaceId)

  // 当发送新消息时，重置重连状态
  useEffect(() => {
    if (isLoading) {
      reconnect.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])

  // 当重连流结束时，从 API 重新加载完整消息
  const reconnectFinishedRef = useRef(false)
  useEffect(() => {
    if (reconnect.finished && !reconnectFinishedRef.current) {
      reconnectFinishedRef.current = true
      fetch(buildConvUrl())
        .then((r) => r.json())
        .then((data) => {
          const conv = data.conversation
          if (!conv) return
          setSidebarConv(conv)
          const refreshed: UIMessage[] = conv.messages
            .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
            .map((m: { id: string; role: string; content: string; timestamp: string; toolCalls?: unknown[]; usage?: Record<string, unknown> | null; stepUsages?: Array<Record<string, unknown>> | null }) => {
              const parts: UIMessage['parts'] = []
              if (m.toolCalls && m.toolCalls.length > 0) {
                for (const tc of m.toolCalls as { toolCallId: string; toolName: string; isError: boolean; input: unknown; output: unknown; errorText?: string }[]) {
                  parts.push({
                    type: 'dynamic-tool',
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    state: tc.isError ? 'output-error' : 'output-available',
                    input: tc.input,
                    output: tc.isError ? undefined : tc.output,
                    errorText: tc.errorText,
                  } as unknown as NonNullable<UIMessage['parts']>[number])
                }
              }
              if (m.content) parts.push({ type: 'text' as const, text: m.content })
              return {
                id: m.id,
                role: m.role as 'user' | 'assistant',
                parts,
                metadata: { timestamp: m.timestamp, usage: m.usage ?? null, stepUsages: m.stepUsages ?? null },
              }
            })
          setMessages(refreshed)
          reconnect.reset()
        })
        .catch(() => {})
    }
  }, [reconnect.finished, convId, setMessages, reconnect, buildConvUrl])

  // 持久化 sidebarOpen 到 localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen))
  }, [sidebarOpen])

  // 流结束后从服务端重新加载消息
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if ((prev === 'streaming' || prev === 'submitted') && status === 'ready') {
      fetch(buildConvUrl())
        .then((r) => r.json())
        .then((data) => {
          const conv = data.conversation
          if (!conv) return
          setSidebarConv(conv)
          setMessages((prevMessages) => {
            return prevMessages.map((msg) => {
              const serverMsg = conv.messages.find((m: { id: string }) => m.id === msg.id)
              if (serverMsg) {
                return {
                  ...msg,
                  metadata: {
                    timestamp: serverMsg.timestamp,
                    usage: serverMsg.usage ?? null,
                    stepUsages: serverMsg.stepUsages ?? null,
                  },
                }
              }
              return msg
            })
          })
        })
        .catch(() => {})
    }
  }, [status, convId, setMessages, buildConvUrl])

  useEffect(() => {
    const pendingMsg = sessionStorage.getItem(pendingMsgKey)
    if (pendingMsg) {
      sessionStorage.removeItem(pendingMsgKey)
      sendMessage({ text: pendingMsg })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    reconnectFinishedRef.current = false
    reconnect.reset()
    const msg = inputText.trim()
    if (!msg || isLoading) return
    setInputText('')
    sendMessage({ text: msg })
  }

  // ─── 自定义停止 ────────────────────────────────────────────────
  async function handleStop() {
    await fetch(buildConvUrl('/stop'), { method: 'POST' }).catch(() => {})
    stop()
  }

  // ─── 合并重连流式内容到消息列表 ────────────────────────────────────────────
  const hasReconnectContent = reconnect.connected && reconnect.streamingParts.length > 0
  const replacedMsgIdxRef = useRef(-1)
  const displayMessages: UIMessage[] = hasReconnectContent
    ? (() => {
        const result = [...messages]
        let lastAssistantIdx = -1
        for (let i = result.length - 1; i >= 0; i--) {
          if (result[i].role === 'assistant') {
            lastAssistantIdx = i
            break
          }
        }
        if (lastAssistantIdx >= 0) {
          result[lastAssistantIdx] = {
            ...result[lastAssistantIdx],
            parts: reconnect.streamingParts,
          }
          replacedMsgIdxRef.current = lastAssistantIdx
        } else {
          result.push({
            id: `reconnect-${convId}`,
            role: 'assistant' as const,
            parts: reconnect.streamingParts,
          })
          replacedMsgIdxRef.current = result.length - 1
        }
        return result
      })()
    : ((replacedMsgIdxRef.current = -1), messages)

  const isReconnecting = reconnect.reconnecting
  const showReconnectStreaming = hasReconnectContent && !reconnect.finished

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* 主内容区 */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0 }}>
        {/* 极简 Header */}
        <div style={{ height: 'var(--header-height)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <button
              onClick={() => router.replace('/tasks', { scroll: false })}
              className="dashboard-back-btn"
              title="返回仪表盘">
              <ArrowLeft size={14} />
            </button>
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') {
                    setEditingTitle(false)
                    setTitleValue(title)
                  }
                }}
                style={{
                  fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)',
                  background: 'var(--color-bg-secondary, #f5f5f5)',
                  border: '1px solid var(--color-accent)', borderRadius: '4px',
                  padding: '2px 6px', outline: 'none', maxWidth: '280px',
                }}
              />
            ) : (
              <h3
                onClick={() => setEditingTitle(true)}
                style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px', cursor: 'pointer' }}
                title="点击编辑标题"
              >
                {sidebarConv?.title || title}
              </h3>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* 重连状态指示 */}
            {reconnect.connected && (
              <span style={{ fontSize: '11px', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-accent)', display: 'inline-block', animation: 'pulse-soft 2s ease-in-out infinite' }} />
                {reconnect.finished ? '已完成' : '生成中…'}
              </span>
            )}

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-fast"
              style={{ border: '1px solid var(--color-border)', background: sidebarOpen ? 'var(--color-accent-subtle)' : 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { if (!sidebarOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
              title={sidebarOpen ? '关闭工作区' : '打开工作区'}>
              <PanelRight size={14} />
              <span>{sidebarOpen ? '隐藏' : '工作区'}</span>
            </button>
          </div>
        </div>

        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {isReconnecting && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Loader2 size={14} className="tool-spinner" />
              正在连接会话…
            </div>
          )}
          {displayMessages.map((msg, idx) => {
            const isReconnectMsg = msg.id.startsWith('reconnect-') || idx === replacedMsgIdxRef.current
            const isLastAssistant = msg.role === 'assistant' && idx === displayMessages.length - 1
            const streaming = isReconnectMsg ? showReconnectStreaming : isLoading && isLastAssistant
            return (
              <div key={msg.id} style={{ width: '100%' }}>
                <MessageRow message={msg} agentName={agentName} isStreaming={streaming} />
              </div>
            )
          })}
          {error && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, background: 'color-mix(in srgb, var(--color-status-failed) 10%, transparent)', border: '1px solid var(--color-status-failed)', color: 'var(--color-status-failed)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={14} /> {error.message}
            </div>
          )}
          {reconnect.error && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, background: 'color-mix(in srgb, var(--color-status-failed) 10%, transparent)', border: '1px solid var(--color-status-failed)', color: 'var(--color-status-failed)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={14} /> {reconnect.error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 能力标签 */}
        {displayMessages.length === 0 && <CapabilityTags onSelect={(label) => setInputText(label + ' ')} />}

        {/* 文件访问授权 */}
        <FsAccessBanner />

        {/* 输入框 */}
        <KimInputBar
          value={inputText}
          onChange={setInputText}
          onSubmit={handleSend}
          onStop={handleStop}
          isLoading={isLoading || isReconnecting}
          agentName={agentName}
          agents={agents}
          onAgentChange={onAgentChange}
        />
      </div>

      {/* 会话侧边栏 - 桌面端显示，移动端隐藏 */}
      <div className="hidden md:block">
        <SessionSidebar
          open={sidebarOpen}
          conversation={sidebarConv}
        />
      </div>
    </div>
  )
}

// ─── 新建草稿态 ───────────────────────────────────────────────────────────────

function NewChatDraft({
  agentName, onAgentChange, onCreated, agents, workspaceId,
}: {
  agentName: string; onAgentChange: (name: string) => void
  onCreated: (convId: string, firstMsg: string) => void; agents: AgentEntry[]
  workspaceId?: string | null
}) {
  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleSend() {
    const msg = input.trim()
    if (!msg || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName,
          mode: 'chat',
          title: msg.slice(0, 30),
          ...(workspaceId ? { type: 'workspace', workspaceId } : { type: 'global' }),
        }),
      })
      const data = await res.json()
      const convId: string = data.data?.conversation?.id
      if (!convId) throw new Error('创建会话失败')
      onCreated(convId, msg)
    } catch (err) {
      console.error(err)
      setCreating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 欢迎屏 */}
      <WelcomeScreen
        agentName={agentName}
        agents={agents}
        onAgentChange={onAgentChange}
        onTagClick={(label) => setInput(label + ' ')}
      />

      {/* 能力标签 */}
      <CapabilityTags onSelect={(label) => setInput(label + ' ')} />

      {/* 文件访问授权 */}
      <FsAccessBanner />

      {/* 输入框 */}
      <KimInputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSend}
        onStop={() => {}}
        isLoading={creating}
        agentName={agentName}
        agents={agents}
        onAgentChange={onAgentChange}
      />
    </div>
  )
}

// ─── 主容器 ───────────────────────────────────────────────────────────────────

function TasksPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const convIdParam = searchParams.get('convId')
  const workspaceIdParam = searchParams.get('workspaceid') || searchParams.get('workspaceId')

  const [draftAgent, setDraftAgent] = useState(DEFAULT_AGENT)
  const [conv, setConv] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(false)
  const [agents, setAgents] = useState<AgentEntry[]>([])

  // 加载 agent 列表
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((d) => setAgents((d.agents ?? []).filter((a: AgentEntry) => a.enabled)))
      .catch(() => {})
  }, [])

  const loadConv = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const typeParam = workspaceIdParam ? 'workspace' : 'global'
      const wsParam = workspaceIdParam ? `&workspaceId=${workspaceIdParam}` : ''
      const url = `/api/conversations/${id}?type=${typeParam}${wsParam}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setConv(data.conversation)
      } else {
        setConv(null)
      }
    } catch {
      setConv(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceIdParam])

  useEffect(() => {
    if (convIdParam) loadConv(convIdParam)
    else setConv(null)
  }, [convIdParam, loadConv])

  async function handleAgentChange(agentName: string) {
    setDraftAgent(agentName)
    if (!conv) return
    try {
      const typeParam = workspaceIdParam ? 'type=workspace' : ''
      const wsParam = workspaceIdParam ? `workspaceId=${workspaceIdParam}` : ''
      const params = [typeParam, wsParam].filter(Boolean).join('&')
      const url = `/api/conversations/${conv.id}/agent${params ? `?${params}` : ''}`
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      })
      if (res.ok) setConv((await res.json()).conversation)
    } catch {
      // 忽略错误
    }
  }

  function handleConvCreated(convId: string, firstMsg: string) {
    sessionStorage.setItem(`manta:pending-msg:${convId}`, firstMsg)
    const wsParam = workspaceIdParam ? `workspaceId=${workspaceIdParam}&` : ''
    router.replace(`/tasks?${wsParam}convId=${convId}`, { scroll: false })
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={20} className="tool-spinner" style={{ color: 'var(--color-accent)' }} />
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginLeft: '8px' }}>加载中…</span>
      </div>
    )
  }

  if (conv) {
    const initialMessages: UIMessage[] = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const parts: UIMessage['parts'] = []

        if (m.toolCalls && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            parts.push({
              type: 'dynamic-tool',
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              state: tc.isError ? 'output-error' : 'output-available',
              input: tc.input,
              output: tc.isError ? undefined : tc.output,
              errorText: tc.errorText,
            } as unknown as NonNullable<UIMessage['parts']>[number])
          }
        }

        if (m.content) {
          parts.push({ type: 'text' as const, text: m.content })
        }

        return {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          parts,
          metadata: { timestamp: m.timestamp, usage: m.usage ?? null },
        }
      })

    return (
      <ChatView
        key={conv.id}
        convId={conv.id}
        agentName={conv.agentName}
        initialMessages={initialMessages}
        title={conv.title}
        onAgentChange={handleAgentChange}
        onNewChat={() => {
          setConv(null)
          const wsParam = workspaceIdParam ? `?workspaceId=${workspaceIdParam}` : ''
          router.replace(`/tasks${wsParam}`, { scroll: false })
        }}
        agents={agents}
        conversation={conv}
        workspaceId={workspaceIdParam}
      />
    )
  }

  return (
    <NewChatDraft
      agentName={draftAgent}
      onAgentChange={setDraftAgent}
      onCreated={handleConvCreated}
      agents={agents}
      workspaceId={workspaceIdParam}
    />
  )
}

export default function TasksPageWrapper() {
  return (
    <Suspense fallback={<SkeletonChatPage />}>
      <TasksPage />
    </Suspense>
  )
}
