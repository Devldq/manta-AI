/* AI start: Agentic assistant — 极简仪表盘 */
'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { TaskCard, type TaskCardData, type TaskStatus } from './TaskCard'

interface DashboardConv {
  id: string
  title: string
  agentName: string
  messages: Array<{ role: string }>
  updatedAt: string
}

interface AgentEntry {
  name: string
  description?: string
  enabled: boolean
}

interface TaskDashboardProps {
  agents: AgentEntry[]
  agentName: string
  onAgentChange: (name: string) => void
  onCreated: (convId: string, firstMsg: string) => void
}

const RUNNING_THRESHOLD_MS = 60_000

function getStatus(conv: DashboardConv, activeId: string | null): TaskStatus {
  if (conv.id === activeId) return 'running'
  if (!conv.messages || conv.messages.length === 0) return 'idle'
  try {
    const elapsed = Date.now() - new Date(conv.updatedAt).getTime()
    if (elapsed < RUNNING_THRESHOLD_MS) return 'running'
  } catch {}
  return 'done'
}

export function TaskDashboard({
  agents,
  agentName,
  onAgentChange,
  onCreated,
}: TaskDashboardProps) {
  const router = useRouter()
  const [conversations, setConversations] = useState<DashboardConv[]>([])

  const activeId = useMemo(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('convId')
  }, [])

  useEffect(() => {
    const poll = () => {
      fetch('/api/conversations')
        .then((r) => r.json())
        .then((data) => setConversations(data.conversations ?? []))
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [])

  const taskCards = useMemo<TaskCardData[]>(() => {
    return conversations.map((c) => ({
      convId: c.id,
      title: c.title || '未命名任务',
      agentName: c.agentName,
      status: getStatus(c, activeId),
      toolCount: c.messages?.length ?? 0,
      lastActive: c.updatedAt,
      isActive: c.id === activeId,
    }))
  }, [conversations, activeId])

  const activeTasks = taskCards.filter((t) => t.status === 'running')
  const recentTasks = taskCards.filter((t) => t.status !== 'running').slice(0, 6)

  const handleSelect = (convId: string) => {
    router.replace(`/tasks?convId=${convId}`, { scroll: false })
  }

  const handleStop = async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}/stop`, { method: 'POST' })
    } catch {}
  }

  const hasAnyTasks = taskCards.length > 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
    }}>
      {/* ─── 主区域：居中输入 + 任务列表 ─── */}
      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        padding: hasAnyTasks ? 'var(--space-2xl) var(--space-2xl) 0' : '0',
      }}>
        {/* ─── 无任务：英雄区，输入居中 ─── */}
        {!hasAnyTasks && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '0 var(--space-2xl)',
          }}>
            {/* 蝠鲼图标 — 更小更精致 */}
            <svg width="72" height="56" viewBox="0 0 160 130" fill="none"
              style={{ opacity: 0.55, marginBottom: '28px', color: 'var(--color-text-secondary)' }}>
              <path d="M0 114 C22 107, 40 121, 62 114 C84 107, 104 121, 130 114 C142 110, 152 117, 160 114" stroke="currentColor" strokeWidth="1.4" opacity="0.4" fill="none" strokeLinecap="round"/>
              <path d="M80 38 C92 42, 102 52, 104 64 C106 76, 98 86, 82 90 C66 94, 52 88, 46 76 C40 64, 46 50, 58 44 C64 41, 72 38, 80 38Z" stroke="currentColor" strokeWidth="1.6" fill="none"/>
              <path d="M100 52 C114 40, 130 24, 148 14 C153 11, 156 15, 152 20 C140 34, 120 48, 108 58" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              <path d="M104 68 C118 62, 136 54, 148 46 C152 44, 153 48, 150 52 C138 62, 118 70, 104 72" stroke="currentColor" strokeWidth="1.1" opacity="0.5" fill="none" strokeLinecap="round"/>
              <path d="M56 50 C42 44, 24 38, 8 36 C4 35, 4 39, 8 42 C22 48, 42 54, 56 58" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              <path d="M50 70 C36 66, 20 62, 8 60 C4 59, 4 63, 8 65 C20 68, 36 72, 50 74" stroke="currentColor" strokeWidth="1.1" opacity="0.5" fill="none" strokeLinecap="round"/>
              <path d="M66 42 C60 32, 56 22, 58 14 C59 10, 63 11, 64 16 C65 22, 66 32, 68 40" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
              <path d="M92 44 C98 34, 102 22, 100 14 C99 10, 95 11, 94 16 C93 22, 91 32, 90 42" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
              <path d="M64 72 C66 80, 72 84, 80 84 C88 84, 94 80, 96 72" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
              <circle cx="66" cy="58" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <circle cx="66" cy="58" r="1" fill="currentColor"/>
              <circle cx="94" cy="58" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <circle cx="94" cy="58" r="1" fill="currentColor"/>
            </svg>

            <h1 style={{
              fontSize: '22px', fontWeight: 600, color: 'var(--color-text-primary)',
              marginBottom: '6px', textAlign: 'center', letterSpacing: '-0.02em',
            }}>
              有什么我可以帮你的？
            </h1>
            <p style={{
              fontSize: '14px', color: 'var(--color-text-muted)', textAlign: 'center',
              lineHeight: '1.6', marginBottom: '32px',
            }}>
              直接描述你的需求，我会立即开始工作
            </p>
          </div>
        )}

        {/* ─── 活跃任务 ─── */}
        {activeTasks.length > 0 && (
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <div style={{
              fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-md)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: 'var(--color-accent)', display: 'inline-block',
                animation: 'dot-breathe 2.4s var(--ease-in-out-quart) infinite',
              }} />
              进行中 ({activeTasks.length})
            </div>
            <div className="task-grid">
              {activeTasks.map((task, idx) => (
                <TaskCard
                  key={task.convId}
                  task={task}
                  onSelect={handleSelect}
                  onStop={handleStop}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}

        {/* ─── 最近任务 ─── */}
        {hasAnyTasks && recentTasks.length > 0 && (
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <div style={{
              fontSize: '12px', fontWeight: 500, color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-md)',
            }}>
              最近
            </div>
            <div className="task-grid">
              {recentTasks.map((task, idx) => (
                <TaskCard
                  key={task.convId}
                  task={task}
                  onSelect={handleSelect}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── 底部输入 — 始终可见，视觉重心 ─── */}
      <div style={{ padding: '16px 20px 20px', flexShrink: 0 }}>
        <QuickInput
          agentName={agentName}
          agents={agents}
          onAgentChange={onAgentChange}
          onCreated={onCreated}
        />
      </div>
    </div>
  )
}

/* ─── 底部输入组件 ─── */

function QuickInput({
  agentName, agents, onAgentChange, onCreated,
}: {
  agentName: string
  agents: AgentEntry[]
  onAgentChange: (name: string) => void
  onCreated: (convId: string, firstMsg: string) => void
}) {
  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const agentDropRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  useEffect(() => {
    if (!agentOpen) return
    function outside(e: MouseEvent) {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target as Node)) setAgentOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [agentOpen])

  async function handleSend() {
    const msg = input.trim()
    if (!msg || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName, mode: 'chat', title: msg.slice(0, 30) }),
      })
      const data = await res.json()
      const convId: string = data.conversation?.id
      if (!convId) throw new Error('创建会话失败')
      onCreated(convId, msg)
    } catch {
      setCreating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!creating && input.trim()) handleSend()
    }
  }

  const canSend = input.trim() && !creating

  return (
    <div style={{
      maxWidth: '680px', margin: '0 auto', width: '100%',
    }}>
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        transition: 'border-color var(--duration-normal) var(--ease-out-quart), box-shadow var(--duration-normal) var(--ease-out-quart)',
      }}>
        {/* 输入区 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={creating ? '正在创建…' : '描述你想做的事情…'}
            disabled={creating}
            rows={1}
            autoFocus
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', resize: 'none',
              fontSize: '14px', fontFamily: 'inherit',
              color: 'var(--color-text-primary)',
              lineHeight: '1.6', minHeight: '24px',
              maxHeight: '120px', padding: '2px 0',
            }}
          />

          {/* 发送按钮 */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              width: '32px', height: '32px', borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', flexShrink: 0,
              background: canSend ? 'var(--color-accent)' : 'var(--color-border-subtle)',
              color: canSend ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              cursor: canSend ? 'pointer' : 'default',
              fontSize: '16px', transition: 'all var(--duration-fast) var(--ease-out-quart)',
              transform: canSend ? 'scale(1)' : 'scale(0.95)',
              boxShadow: canSend ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {creating
              ? <span style={{ width: '12px', height: '12px', border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              : '↑'}
          </button>
        </div>

        {/* 底部栏：agent + 提示 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 14px 10px',
        }}>
          <div ref={agentDropRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setAgentOpen((o) => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '4px 8px', borderRadius: '6px',
                border: '1px solid var(--color-border-subtle)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)',
                transition: 'color var(--duration-fast) var(--ease-out-quart), border-color var(--duration-fast) var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-accent)'
                e.currentTarget.style.borderColor = 'var(--color-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-text-muted)'
                e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
              }}
            >
              {agentName}
              <span style={{ fontSize: '8px', opacity: 0.5 }}>▾</span>
            </button>
            {agentOpen && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 100,
                minWidth: '160px', background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border)', borderRadius: '10px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)', overflow: 'hidden',
              }}>
                {agents.map((a) => (
                  <button
                    key={a.name}
                    onClick={() => { onAgentChange(a.name); setAgentOpen(false) }}
                    style={{
                      width: '100%', padding: '8px 12px', textAlign: 'left',
                      border: 'none', cursor: 'pointer', fontSize: '12px',
                      background: a.name === agentName ? 'var(--color-accent-subtle)' : 'transparent',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      transition: 'background-color var(--duration-fast) var(--ease-out-quart)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = a.name === agentName ? 'var(--color-accent-subtle)' : 'transparent'
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', opacity: 0.5 }}>
            Enter 发送 · Shift+Enter 换行
          </span>
        </div>
      </div>
    </div>
  )
}
