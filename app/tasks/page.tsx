/*  start: 任务页面 — 支持 convId（对话模式）和 taskId（任务日志模式）*/
'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AgentSelector } from '../components/AgentSelector'

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system-notice'
  content: string
  timestamp: string
  taskId?: string
  streaming?: boolean
  /** AI: chat 模式下回复本条消息的 agent 名称 */
  agentName?: string
}

interface Conversation {
  id: string
  title: string
  agentName: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  /** chat = LangChain 直接对话；task = OpenClaw Task 执行（默认）*/
  mode?: 'chat' | 'task'
}

type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  agentName?: string
  workflowId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: '待处理', planning: '规划中', running: '进行中',
  done: '已完成', failed: '失败', archived: '已归档',
}
const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: '#6b7280', planning: '#a855f7', running: '#3b82f6',
  done: '#22c55e', failed: '#ef4444', archived: '#6b7280',
}

const DEFAULT_AGENT = 'manta-main'

// ─── 消息行组件 ────────────────────────────────────────────────────────────────
function MsgRow({ msg, currentAgentName, onDelete }: {
  msg: Message
  currentAgentName: string
  onDelete: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  // AI: copy 按钮状态
  const [copied, setCopied] = useState(false)

  // AI: 复制消息内容到剪贴板
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  // AI: 系统通知（agent 切换提示）
  if (msg.role === 'system-notice') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '4px 0' }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', padding: '0 8px' }}>
          {msg.content}
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
      </div>
    )
  }

  // AI: assistant 头像首字母（优先用 agentName，否则用当前 agent）
  const avatarLabel = (msg.agentName || currentAgentName || 'M').slice(0, 1).toUpperCase()
  const agentLabel = msg.agentName || currentAgentName

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {msg.role === 'user' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: '6px' }}>
          {/* 删除按钮（用户消息，在气泡左侧） */}
          <button
            onClick={() => onDelete(msg.id)}
            style={{
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              color: 'var(--color-text-muted)',
              flexShrink: 0,
              marginTop: '10px',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              fontSize: '12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#ef444415' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}
            title="删除消息"
          >✕</button>
          <div
            style={{
              maxWidth: '75%',
              padding: '10px 16px',
              borderRadius: '18px 18px 4px 18px',
              fontSize: '14px',
              lineHeight: '1.6',
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg.content}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              background: 'var(--color-accent)',
              color: '#000',
              marginTop: '2px',
            }}
          >{avatarLabel}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* AI: 显示 agent 名称 */}
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '3px', fontFamily: 'monospace' }}>
              {agentLabel}
            </div>
            <div
              style={{
                padding: '10px 16px',
                borderRadius: '18px 18px 18px 4px',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: 'var(--font-mono)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                position: 'relative',
              }}
            >
              {/* AI: copy 按钮（放在气泡内容右上角） */}
              {msg.content && !msg.streaming && (
                <button
                  onClick={handleCopy}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    opacity: hovered ? 0.6 : 0,
                    transition: 'opacity 0.15s',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    zIndex: 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.background = 'var(--color-border)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}
                  title={copied ? '已复制' : '复制内容'}
                >
                  {copied ? '✓' : '📋'}
                </button>
              )}
              {msg.content
                ? <>
                    {msg.content}
                    {msg.streaming && (
                      <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--color-accent)', marginLeft: '2px', verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
                    )}
                  </>
                : <span style={{ color: 'var(--color-text-muted)' }}>{msg.streaming ? '▋' : '（无输出）'}</span>
              }
            </div>
            {msg.taskId && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                task:{msg.taskId.slice(0, 8)}
              </span>
            )}
          </div>
          {/* 删除按钮（assistant 消息，在气泡右侧） */}
          <button
            onClick={() => onDelete(msg.id)}
            style={{
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              color: 'var(--color-text-muted)',
              flexShrink: 0,
              marginTop: '6px',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              fontSize: '12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#ef444415' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}
            title="删除消息"
          >✕</button>
        </div>
      )}
    </div>
  )
}

// ─── 输入框组件 ────────────────────────────────────────────────────────────────
function InputBar({
  value,
  onChange,
  onSend,
  onInterrupt,
  sending,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onInterrupt: () => void
  sending: boolean
  placeholder: string
}) {
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: '14px',
            borderRadius: '12px',
            resize: 'none',
            outline: 'none',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            minHeight: '52px',
            maxHeight: '180px',
            fontFamily: 'inherit',
          }}
          rows={2}
          disabled={sending}
          autoFocus
        />
        {sending ? (
          <button
            onClick={onInterrupt}
            style={{
              padding: '10px 16px',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 500,
              background: '#ef444418',
              border: '1px solid #ef4444',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >中断</button>
        ) : (
          <button
            onClick={onSend}
            disabled={!value.trim()}
            style={{
              padding: '10px 16px',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: 500,
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
              border: 'none',
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              opacity: value.trim() ? 1 : 0.4,
            }}
          >发送</button>
        )}
      </div>
    </div>
  )
}

// ─── 主页面 ────────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const convIdParam = searchParams.get('convId')
  const taskIdParam = searchParams.get('taskId')

  // ── 对话模式 ──
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [convLoading, setConvLoading] = useState(false)
  const [draftAgent, setDraftAgent] = useState(DEFAULT_AGENT)

  // ── 任务日志模式 ──
  const [taskView, setTaskView] = useState<{ task: Task; logs: string; output: string } | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  // 任务视图关联的对话（持久化，刷新可恢复）
  const [taskConv, setTaskConv] = useState<Conversation | null>(null)

  // ── 共用 ──
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // AI: 跳过 convId 变化时的 loadConversation（防止覆盖乐观渲染的消息）
  const skipLoadRef = useRef<string | null>(null)

  useEffect(() => {
    if (taskIdParam) {
      setConversation(null)
      loadTaskView(taskIdParam, convIdParam)
    } else if (convIdParam) {
      // AI: 如果是 ensureConversation 刚创建并写入 URL 的会话，跳过加载（防止覆盖乐观消息）
      if (skipLoadRef.current === convIdParam) {
        skipLoadRef.current = null
        return
      }
      setTaskView(null)
      setTaskConv(null)
      loadConversation(convIdParam)
    } else {
      setConversation(null)
      setTaskView(null)
      setTaskConv(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIdParam, convIdParam])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages, taskConv?.messages])

  // ── 加载 ──────────────────────────────────────────────────────────────────

  async function loadTaskView(taskId: string, convId?: string | null) {
    setTaskLoading(true)
    setTaskConv(null)
    try {
      const [taskRes, logsRes, outputRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch(`/api/tasks/${taskId}/logs`),
        fetch(`/api/tasks/${taskId}/output`),
      ])
      const taskData = await taskRes.json()
      const logsData = logsRes.ok ? await logsRes.json() : {}
      const outputData = outputRes.ok ? await outputRes.json() : {}
      setTaskView({
        task: taskData.task,
        logs: logsData.logs ?? '',
        output: outputData.content ?? '',
      })
      // 若 URL 中有 convId，同时加载对应对话
      if (convId) {
        const convRes = await fetch(`/api/conversations/${convId}`)
        if (convRes.ok) {
          const convData = await convRes.json()
          setTaskConv(convData.conversation)
        }
      }
    } catch {}
    setTaskLoading(false)
  }

  async function loadConversation(convId: string) {
    setConvLoading(true)
    try {
      const res = await fetch(`/api/conversations/${convId}`)
      if (res.ok) {
        const data = await res.json()
        setConversation(data.conversation)
        setConvLoading(false)
        return
      }
    } catch {}
    setConversation(null)
    setConvLoading(false)
    router.replace('/tasks', { scroll: false })
  }

  async function ensureConversation(): Promise<Conversation | null> {
    if (conversation) return conversation
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: draftAgent, mode: 'chat' }),
      })
      const data = await res.json()
      const newConv: Conversation = data.conversation
      setConversation(newConv)
      // AI: 用 skipLoad ref 阻止 URL 变化触发 loadConversation 覆盖乐观渲染的消息
      skipLoadRef.current = newConv.id
      router.replace(`/tasks?convId=${newConv.id}`, { scroll: false })
      return newConv
    } catch {
      return null
    }
  }

  function startNewDraft() {
    setConversation(null)
    setTaskView(null)
    setTaskConv(null)
    setDraftAgent(DEFAULT_AGENT)
    router.replace('/tasks', { scroll: false })
  }

  // ── LangChain Chat 模式流式输出 ────────────────────────────────────────────
  async function streamChatOutput(
    convId: string,
    message: string,
    assistantMsgId: string,
    signal: AbortSignal,
    setConv: React.Dispatch<React.SetStateAction<Conversation | null>>,
    agentName: string
  ) {
    return new Promise<void>((resolve, reject) => {
      fetch(`/api/conversations/${convId}/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, agentName }),
        signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const errText = await res.text()
            let errMsg = 'LangChain 连接失败'
            try { errMsg = JSON.parse(errText).error ?? errMsg } catch {}
            reject(new Error(errMsg))
            return
          }
          if (!res.body) { reject(new Error('SSE 响应为空')); return }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            let event = '', dataStr = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) event = line.slice(7).trim()
              else if (line.startsWith('data: ')) dataStr = line.slice(6).trim()
              else if (line === '') {
                if (event && dataStr) {
                  try {
                    const payload = JSON.parse(dataStr)
                    if (event === 'chunk') {
                      const text: string = payload.text ?? ''
                      setConv((prev) => prev ? {
                        ...prev,
                        messages: prev.messages.map((m) =>
                          m.id === assistantMsgId ? { ...m, content: m.content + text, streaming: true } : m
                        ),
                      } : prev)
                    } else if (event === 'done') {
                      const finalContent = payload.content ?? ''
                      setConv((prev) => prev ? {
                        ...prev,
                        messages: prev.messages.map((m) =>
                          m.id === assistantMsgId ? { ...m, content: finalContent, streaming: false } : m
                        ),
                      } : prev)
                      resolve(); return
                    } else if (event === 'error') {
                      reject(new Error(payload.message ?? 'LangChain 错误')); return
                    }
                  } catch {}
                }
                event = ''; dataStr = ''
              }
            }
          }
          resolve()
        })
        .catch((err) => err?.name === 'AbortError' ? resolve() : reject(err))
    })
  }

  // ── SSE 流式输出（通用，传入 setter）────────────────────────────────────────
  async function streamOutput(
    convId: string,
    taskId: string,
    assistantMsgId: string,
    signal: AbortSignal,
    setConv: React.Dispatch<React.SetStateAction<Conversation | null>>
  ) {
    return new Promise<void>((resolve, reject) => {
      fetch(`/api/conversations/${convId}/stream?taskId=${taskId}`, { signal })
        .then(async (res) => {
          if (!res.ok || !res.body) { reject(new Error('SSE 连接失败')); return }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = '', accLog = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            let event = '', dataStr = ''
            for (const line of lines) {
              if (line.startsWith('event: ')) event = line.slice(7).trim()
              else if (line.startsWith('data: ')) dataStr = line.slice(6).trim()
              else if (line === '') {
                if (event && dataStr) {
                  try {
                    const payload = JSON.parse(dataStr)
                    if (event === 'log') {
                      accLog += payload.chunk ?? ''
                      setConv((prev) => prev ? { ...prev, messages: prev.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, content: accLog, streaming: true } : m
                      )} : prev)
                    } else if (event === 'done') {
                      const finalContent = payload.content || accLog
                      setConv((prev) => prev ? { ...prev, messages: prev.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, content: finalContent, streaming: false } : m
                      )} : prev)
                      resolve(); return
                    } else if (event === 'error') { reject(new Error(payload.message ?? 'SSE 错误')); return }
                  } catch {}
                }
                event = ''; dataStr = ''
              }
            }
          }
          resolve()
        })
        .catch((err) => err?.name === 'AbortError' ? resolve() : reject(err))
    })
  }

  // ── 对话模式发消息（LangChain 直接聊天）──────────────────────────────────
  async function handleSend() {
    const userMsg = inputText.trim()
    if (!userMsg || sending) return
    setSending(true)
    setInputText('')

    const conv = await ensureConversation()
    if (!conv) { setSending(false); return }

    const tempUserId = `tmp-user-${Date.now()}`
    const tempAssistantId = `tmp-asst-${Date.now()}`

    setConversation((prev) => prev ? {
      ...prev,
      messages: [
        ...prev.messages,
        { id: tempUserId, role: 'user', content: userMsg, timestamp: new Date().toISOString() },
        { id: tempAssistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), streaming: true, agentName: currentAgent },
      ],
    } : prev)

    try {
      const abort = new AbortController()
      abortRef.current = abort
      await streamChatOutput(conv.id, userMsg, tempAssistantId, abort.signal, setConversation, currentAgent)
    } catch (err) {
      setConversation((prev) => prev ? {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === tempAssistantId ? { ...m, content: `❌ ${String(err)}`, streaming: false } : m
        ),
      } : prev)
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  // ── 任务视图发消息（持久化到 conversation，写入 URL）────────────────────────
  async function handleSendFromTask(task: Task) {
    const userMsg = inputText.trim()
    if (!userMsg || sending) return
    setSending(true)
    setInputText('')

    const tempUserId = `tmp-user-${Date.now()}`
    const tempAssistantId = `tmp-asst-${Date.now()}`

    // 乐观更新 UI
    const optimisticMsg = (prev: Conversation | null): Conversation | null => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [
          ...prev.messages,
          { id: tempUserId, role: 'user', content: userMsg, timestamp: new Date().toISOString() },
          { id: tempAssistantId, role: 'assistant', content: '', timestamp: new Date().toISOString(), streaming: true },
        ],
      }
    }

    try {
      // 创建或复用 taskConv
      let conv = taskConv
      if (!conv) {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName: task.agentName || DEFAULT_AGENT, title: task.title }),
        })
        conv = (await res.json()).conversation as Conversation
        // 写入 URL，使刷新可恢复
        router.replace(`/tasks?taskId=${task.id}&convId=${conv.id}`, { scroll: false })
      }
      setTaskConv(optimisticMsg(conv) ?? conv)

      const msgRes = await fetch(`/api/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMsg, hideTask: true }),
      })
      if (!msgRes.ok) { const e = await msgRes.json(); throw new Error(e.error ?? '发送失败') }
      const { task: newTask } = await msgRes.json()
      if (!newTask?.id) throw new Error('未获取到 taskId')

      const abort = new AbortController()
      abortRef.current = abort
      await streamOutput(conv.id, newTask.id, tempAssistantId, abort.signal, setTaskConv)
    } catch (err) {
      setTaskConv((prev) => prev ? {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === tempAssistantId ? { ...m, content: `❌ ${String(err)}`, streaming: false } : m
        ),
      } : prev)
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  // ── 删除消息（通用）──────────────────────────────────────────────────────
  async function handleDeleteMessage(convId: string, msgId: string, isTaskConv: boolean) {
    const setter = isTaskConv ? setTaskConv : setConversation
    setter((prev) => prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== msgId) } : prev)
    try {
      await fetch(`/api/conversations/${convId}/messages/${msgId}`, { method: 'DELETE' })
    } catch {}
  }

  // ── Agent 切换 ────────────────────────────────────────────────────────────
  async function handleAgentChange(agentName: string) {
    const prevAgent = currentAgent
    setDraftAgent(agentName)
    if (!conversation) return
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      })
      if (res.ok) setConversation((await res.json()).conversation)
    } catch {}
    // AI: chat 模式下切换 agent，插入系统通知消息作为视觉分隔
    if (conversation.mode === 'chat' || draftMode === 'chat') {
      setConversation((prev) => prev ? {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `sys-${Date.now()}`,
            role: 'system-notice' as const,
            content: `已切换为 ${agentName} 角色`,
            timestamp: new Date().toISOString(),
          },
        ],
      } : prev)
    }
  }

  function handleInterrupt(isTaskConv = false) {
    abortRef.current?.abort()
    setSending(false)
    const setter = isTaskConv ? setTaskConv : setConversation
    setter((prev) => prev ? { ...prev, messages: prev.messages.map((m) =>
      m.streaming ? { ...m, streaming: false, content: m.content + '\n\n[已中断]' } : m
    )} : prev)
  }

  const currentAgent = conversation?.agentName ?? draftAgent

  // ─── 加载中 ───────────────────────────────────────────────────────────────
  if (convLoading || taskLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>加载中...</p>
      </div>
    )
  }

  // ─── 任务日志模式 ─────────────────────────────────────────────────────────
  if (taskView) {
    const { task, logs, output } = taskView
    const taskConvId = taskConv?.id
    return (
      <div className="flex-1 flex flex-col" style={{ height: '100%', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6"
          style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {task.title}
            </h3>
            <span className="px-2 py-0.5 text-xs rounded flex-shrink-0" style={{
              background: `${STATUS_COLORS[task.status]}18`,
              color: STATUS_COLORS[task.status],
              border: `1px solid ${STATUS_COLORS[task.status]}40`,
            }}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
          <button onClick={startNewDraft} className="px-2.5 py-1 rounded-md text-xs transition-colors flex-shrink-0"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
            + 新任务
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 任务描述 */}
          {task.description && (
            <div className="flex justify-end">
              <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)', whiteSpace: 'pre-wrap' }}>
                {task.description}
              </div>
            </div>
          )}
          {/* Agent 信息 */}
          <div className="flex justify-center">
            <span className="text-xs px-3 py-1 rounded-full" style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
              {task.agentName || task.workflowId || '未指定执行器'}
            </span>
          </div>
          {/* 执行日志 */}
          {logs && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--color-accent)', color: '#000', marginTop: '2px' }}>M</div>
              <div className="flex-1 px-4 py-3 rounded-2xl rounded-tl-sm text-xs font-mono leading-relaxed"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {logs}
              </div>
            </div>
          )}
          {/* 输出 */}
          {output && task.status === 'done' && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--color-accent)', color: '#000', marginTop: '2px' }}>M</div>
              <div className="flex-1 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
                style={{ background: 'var(--color-accent)15', border: '1px solid var(--color-accent)30', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {output}
              </div>
            </div>
          )}
          {/* 错误 */}
          {task.error && (
            <div className="flex justify-center">
              <span className="text-xs px-3 py-1.5 rounded-full" style={{ color: '#ef4444', border: '1px solid #ef444440', background: '#ef444410' }}>
                ❌ {task.error}
              </span>
            </div>
          )}
          {(!logs && !output && !task.error) && !taskConv && (
            <div className="flex justify-center pt-8">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>暂无执行记录</p>
            </div>
          )}

          {/* 持久化的后续对话 */}
          {taskConv?.messages.map((msg) => (
            <MsgRow
              key={msg.id}
              msg={msg}
              currentAgentName={task.agentName || DEFAULT_AGENT}
              onDelete={(msgId) => taskConvId && handleDeleteMessage(taskConvId, msgId, true)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <InputBar
          value={inputText}
          onChange={setInputText}
          onSend={() => handleSendFromTask(task)}
          onInterrupt={() => handleInterrupt(true)}
          sending={sending}
          placeholder={`继续和 ${task.agentName || DEFAULT_AGENT} 聊…（Shift+Enter 换行）`}
        />
      </div>
    )
  }

  // ─── 对话模式 ─────────────────────────────────────────────────────────────
  // AI: /tasks 页面现在只支持 chat 模式（LLM 直接对话）

  return (
    <div className="flex-1 flex flex-col" style={{ height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6"
        style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold truncate max-w-[200px]"
            style={{ color: 'var(--color-text-primary)' }}>
            {conversation?.title ?? '新对话'}
          </h3>
          {/* AI: 模式标签 — 固定为 AI 对话 */}
          <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{
            background: 'var(--color-accent)18',
            color: 'var(--color-accent)',
            border: '1px solid var(--color-accent)40',
          }}>
            💬 AI 对话
          </span>
        </div>
        <div className="flex items-center gap-2">
          <AgentSelector currentAgent={currentAgent} onSelect={handleAgentChange} disabled={sending} />
          {/* AI: 新建对话按钮 */}
          <button onClick={startNewDraft} className="px-2.5 py-1 rounded-md text-xs transition-colors"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
            + 新对话
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {(!conversation || conversation.messages.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
              style={{ background: 'var(--color-accent)', color: '#000', opacity: 0.8 }}>M</div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>AI 对话</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>与 LLM 直接对话，支持多轮上下文和 Agent 角色切换</p>
          </div>
        )}
        {conversation?.messages.map((msg) => (
          <MsgRow
            key={msg.id}
            msg={msg}
            currentAgentName={currentAgent}
            onDelete={(msgId) => conversation && handleDeleteMessage(conversation.id, msgId, false)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <InputBar
        value={inputText}
        onChange={setInputText}
        onSend={handleSend}
        onInterrupt={() => handleInterrupt(false)}
        sending={sending}
        placeholder={`和 ${currentAgent} 聊天…（Shift+Enter 换行）`}
      />
    </div>
  )
}
/*  end: 任务页面结束 */
