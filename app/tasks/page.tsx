/* 会话聊天页面 — 参照 Kim 设计风格 */
'use client'

import { useState, useEffect, useRef, Suspense, useCallback, memo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage, TextUIPart } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── 类型 ──────────────────────────────────────────────────────────────────────

interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface Conversation {
  id: string
  title: string
  agentName: string
  messages: StoredMessage[]
  createdAt: string
  updatedAt: string
  mode?: 'chat' | 'task'
}

interface AgentEntry {
  name: string
  description?: string
  enabled: boolean
}

const DEFAULT_AGENT = 'main'

// 快捷能力标签
const CAPABILITY_TAGS = [
  { icon: '📄', label: '文档处理' },
  { icon: '🎬', label: '视频生成' },
  { icon: '🔍', label: '深度研究' },
  { icon: '$', label: '金融服务' },
  { icon: '📊', label: '数据分析' },
  { icon: '📈', label: '数据可视化' },
  { icon: '🖥', label: '幻灯片' },
  { icon: '📁', label: '产品管理' },
  { icon: '🎨', label: '图像设计' },
  { icon: '💻', label: '代码开发' },
]

function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is TextUIPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

// 提取为模块级常量，避免每次渲染创建新对象导致 ReactMarkdown 重建 DOM
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  code({ className, children, ...props }) {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      const lang = className?.replace('language-', '') ?? ''
      return (
        <div style={{ margin: '8px 0' }}>
          {lang && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', padding: '4px 12px', background: 'var(--color-surface-elevated)', borderRadius: '6px 6px 0 0', border: '1px solid var(--color-border)', borderBottom: 'none' }}>
              {lang}
            </div>
          )}
          <pre style={{ margin: 0, padding: '12px 16px', overflowX: 'auto', fontSize: '13px', lineHeight: '1.6', fontFamily: 'var(--font-mono)', background: 'var(--color-surface-elevated)', borderRadius: lang ? '0 0 6px 6px' : '6px', border: '1px solid var(--color-border)' }}>
            <code style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }} {...props}>{children}</code>
          </pre>
        </div>
      )
    }
    return <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-emphasis)' }} {...props}>{children}</code>
  },
  iframe({ src, ...props }) {
    return (
      <div style={{ margin: '12px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>📄 预览</div>
        <iframe src={src} sandbox="allow-scripts allow-same-origin" style={{ width: '100%', minHeight: '300px', border: 'none', display: 'block' }} {...props} />
      </div>
    )
  },
  p({ children }) { return <p style={{ margin: '4px 0', lineHeight: '1.7' }}>{children}</p> },
  h1({ children }) { return <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '12px 0 6px' }}>{children}</h1> },
  h2({ children }) { return <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '10px 0 5px' }}>{children}</h2> },
  h3({ children }) { return <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '8px 0 4px' }}>{children}</h3> },
  ul({ children }) { return <ul style={{ paddingLeft: '20px', margin: '4px 0', listStyleType: 'disc' }}>{children}</ul> },
  ol({ children }) { return <ol style={{ paddingLeft: '20px', margin: '4px 0', listStyleType: 'decimal' }}>{children}</ol> },
  li({ children }) { return <li style={{ margin: '2px 0', lineHeight: '1.6' }}>{children}</li> },
  hr() { return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} /> },
  blockquote({ children }) { return <blockquote style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '12px', margin: '8px 0', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{children}</blockquote> },
  table({ children }) { return <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%' }}>{children}</table></div> },
  th({ children }) { return <th style={{ padding: '6px 12px', borderBottom: '2px solid var(--color-border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th> },
  td({ children }) { return <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>{children}</td> },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{children}</a> },
  strong({ children }) { return <strong style={{ fontWeight: 700 }}>{children}</strong> },
  em({ children }) { return <em style={{ fontStyle: 'italic' }}>{children}</em> },
}

const MarkdownContent = memo(function MarkdownContent({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--color-accent)', marginLeft: '2px', verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
      )}
    </div>
  )
})

// ─── 消息行 ────────────────────────────────────────────────────────────────────

const MessageRow = memo(function MessageRow({ message, agentName, isStreaming }: { message: UIMessage; agentName: string; isStreaming: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const content = getTextContent(message)

  async function handleCopy() {
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { }
  }

  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'flex-start' }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ maxWidth: '72%', padding: '10px 16px', borderRadius: '18px 18px 4px 18px', fontSize: '14px', lineHeight: '1.65', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
        </div>
        <button onClick={handleCopy} style={{ opacity: hovered ? 0.5 : 0, transition: 'opacity 0.15s', width: '22px', height: '22px', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5' }}>
          {copied ? '✓' : '⧉'}
        </button>
      </div>
    )
  }

  const avatarLabel = (agentName || 'A').slice(0, 1).toUpperCase()
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, background: 'var(--color-accent)', color: '#000', marginTop: '2px' }}>
        {avatarLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '4px', fontFamily: 'monospace' }}>{agentName}</div>
        <div style={{ fontSize: '14px', lineHeight: '1.65', color: 'var(--color-text-primary)', wordBreak: 'break-word', position: 'relative' }}>
          {content && !isStreaming && (
            <button onClick={handleCopy} style={{ position: 'absolute', top: 0, right: 0, opacity: hovered ? 0.5 : 0, transition: 'opacity 0.15s', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', zIndex: 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5' }}>
              {copied ? '✓' : '⧉'}
            </button>
          )}
          {content
            ? <MarkdownContent content={content} streaming={isStreaming} />
            : <span style={{ color: 'var(--color-text-muted)' }}>
              {isStreaming ? <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--color-accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} /> : '（无输出）'}
            </span>
          }
        </div>
      </div>
    </div>
  )
})

// ─── 底部输入框（Kim 风格）────────────────────────────────────────────────────

function KimInputBar({
  value,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  disabled,
  agentName,
  agents,
  onAgentChange,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  disabled?: boolean
  agentName: string
  agents: AgentEntry[]
  onAgentChange: (name: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const agentDropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [value])

  useEffect(() => {
    if (!agentOpen) return
    function outside(e: MouseEvent) {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target as Node)) setAgentOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [agentOpen])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing=true 时说明输入法正在组字（中文选词），不触发提交
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!isLoading && value.trim()) onSubmit()
    }
  }

  return (
    <div style={{ padding: '0 20px 20px', flexShrink: 0 }}>
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
      }}>
        {/* 顶部工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 14px 0' }}>
          <button style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            title="@提及">
            @
          </button>
          <button style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            title="附件">
            📎
          </button>
        </div>

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled}
          rows={3}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: '14px',
            resize: 'none',
            outline: 'none',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-primary)',
            fontFamily: 'inherit',
            lineHeight: '1.6',
            minHeight: '72px',
            maxHeight: '160px',
            display: 'block',
            boxSizing: 'border-box',
          }}
        />

        {/* 底部工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderTop: '1px solid var(--color-border-subtle)' }}>
          {/* 左侧：Agent / Auto / Skills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Agent 选择器 */}
            <div ref={agentDropRef} style={{ position: 'relative' }}>
              <button
                onClick={() => !disabled && setAgentOpen((o) => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                  background: 'transparent', color: 'var(--color-text-secondary)',
                  cursor: disabled ? 'default' : 'pointer', fontSize: '12px', fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--color-border)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: '12px' }}>◻</span>
                <span>{agentName}</span>
                <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
              </button>
              {agentOpen && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: '180px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                  {agents.length === 0
                    ? <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>暂无 Agent</div>
                    : agents.map((a) => (
                      <button key={a.name} onClick={() => { onAgentChange(a.name); setAgentOpen(false) }}
                        style={{ width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: a.name === agentName ? 'var(--color-accent-subtle)' : 'transparent', color: 'var(--color-text-primary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onMouseEnter={(e) => { if (a.name !== agentName) e.currentTarget.style.background = 'var(--color-border)' }}
                        onMouseLeave={(e) => { if (a.name !== agentName) e.currentTarget.style.background = 'transparent' }}>
                        {a.name === agentName && <span style={{ color: 'var(--color-accent)', fontSize: '10px' }}>✓</span>}
                        <span style={{ fontFamily: 'monospace' }}>{a.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            <button style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontSize: '11px' }}>⚡</span>
              <span>Auto</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
            </button>

            <button style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontSize: '11px' }}>✦</span>
              <span>Skills</span>
            </button>
          </div>

          {/* 右侧：选择文件夹 + 发送 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontSize: '11px' }}>🖥</span>
              <span>选择文件夹</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
            </button>

            {isLoading ? (
              <button onClick={onStop} style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ef4444', background: '#ef444415', color: '#ef4444', cursor: 'pointer', fontSize: '13px' }}>
                ⏹
              </button>
            ) : (
              <button onClick={onSubmit} disabled={!value.trim() || disabled}
                style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: value.trim() ? 'var(--color-text-primary)' : 'var(--color-border)', color: value.trim() ? 'var(--color-background)' : 'var(--color-text-muted)', cursor: value.trim() && !disabled ? 'pointer' : 'not-allowed', transition: 'all 0.15s', fontSize: '14px' }}>
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 欢迎空态（Kim 风格）─────────────────────────────────────────────────────

function WelcomeScreen({
  agentName,
  agents,
  onAgentChange,
  onTagClick,
}: {
  agentName: string
  agents: AgentEntry[]
  onAgentChange: (name: string) => void
  onTagClick: (label: string) => void
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px 20px', minHeight: 0 }}>
      {/* 机器人图标 */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ width: '120px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* SVG 线框机器人风格图标 */}
          <svg width="110" height="110" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.75 }}>
            {/* 天线 */}
            <line x1="55" y1="8" x2="55" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="55" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* 耳机/侧面 */}
            <rect x="12" y="32" width="12" height="20" rx="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <rect x="86" y="32" width="12" height="20" rx="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* 头部 */}
            <rect x="24" y="22" width="62" height="42" rx="14" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* 眼睛 */}
            <circle cx="41" cy="42" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <circle cx="69" cy="42" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <circle cx="41" cy="42" r="2" fill="currentColor"/>
            <circle cx="69" cy="42" r="2" fill="currentColor"/>
            {/* 身体 */}
            <rect x="30" y="68" width="50" height="30" rx="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* 腿 */}
            <rect x="36" y="98" width="14" height="10" rx="5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <rect x="60" y="98" width="14" height="10" rx="5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* 身体格子纹 */}
            <line x1="30" y1="80" x2="80" y2="80" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
            <line x1="55" y1="68" x2="55" y2="98" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
          </svg>
        </div>
      </div>

      {/* 标题 */}
      <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '10px', letterSpacing: '-0.5px', textAlign: 'center' }}>
        Claw Your Ideas Into Reality
      </h1>
      <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '32px', textAlign: 'center' }}>
        Triggered Anywhere, Completed Locally
      </p>

      {/* Agent 切换 tab */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginRight: '4px' }}>开始</span>
        <div style={{ display: 'flex', background: 'var(--color-border)', borderRadius: '24px', padding: '3px', gap: '2px' }}>
          {agents.slice(0, 4).map((a) => (
            <button
              key={a.name}
              onClick={() => onAgentChange(a.name)}
              style={{
                padding: '7px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: a.name === agentName ? 'var(--color-text-primary)' : 'transparent',
                color: a.name === agentName ? 'var(--color-background)' : 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span style={{ fontSize: '12px' }}>{a.name === agentName ? '◻' : '◻'}</span>
              {a.name}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginLeft: '4px' }}>任务</span>
      </div>
    </div>
  )
}

// ─── 能力标签滚动栏 ───────────────────────────────────────────────────────────

function CapabilityTags({ onSelect }: { onSelect: (label: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showRight, setShowRight] = useState(true)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  return (
    <div style={{ position: 'relative', padding: '0 20px 12px', flexShrink: 0 }}>
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        style={{ display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        {CAPABILITY_TAGS.map((tag) => (
          <button
            key={tag.label}
            onClick={() => onSelect(tag.label)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
              padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
              fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
          >
            <span>{tag.icon}</span>
            <span>{tag.label}</span>
          </button>
        ))}
      </div>
      {/* 右侧渐变 + 箭头 */}
      {showRight && (
        <div style={{ position: 'absolute', right: '20px', top: '0', bottom: '12px', width: '48px', background: 'linear-gradient(to right, transparent, var(--color-background))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', pointerEvents: 'all', cursor: 'pointer' }}
            onClick={() => { scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' }) }}>→</span>
        </div>
      )}
    </div>
  )
}

// ─── ChatView（有会话时） ─────────────────────────────────────────────────────

function ChatView({
  convId, agentName, initialMessages, onAgentChange, onNewChat, title, agents,
}: {
  convId: string; agentName: string; initialMessages: UIMessage[]
  onAgentChange: (name: string) => void; onNewChat: () => void; title: string; agents: AgentEntry[]
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [inputText, setInputText] = useState('')
  const pendingMsgKey = `manta:pending-msg:${convId}`

  const { messages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/conversations/${convId}/ai-stream`,
      body: { agentName },
    }),
    messages: initialMessages,
    id: convId,
  })

  const isLoading = status === 'submitted' || status === 'streaming'

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
    const msg = inputText.trim()
    if (!msg || isLoading) return
    setInputText('')
    sendMessage({ text: msg })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 极简 Header */}
      <div style={{ height: 'var(--header-height)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }} title={title}>
          {title}
        </h3>
        <button onClick={onNewChat}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', transition: 'all 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          + 新对话
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {messages.map((msg, idx) => {
          const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1
          return <MessageRow key={msg.id} message={msg} agentName={agentName} isStreaming={isLoading && isLastAssistant} />
        })}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: '#ef444410', border: '1px solid #ef444440', color: '#ef4444' }}>
            ❌ {error.message}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 能力标签 */}
      {messages.length === 0 && <CapabilityTags onSelect={(label) => setInputText(label + ' ')} />}

      {/* 输入框 */}
      <KimInputBar
        value={inputText}
        onChange={setInputText}
        onSubmit={handleSend}
        onStop={stop}
        isLoading={isLoading}
        agentName={agentName}
        agents={agents}
        onAgentChange={onAgentChange}
      />
    </div>
  )
}

// ─── 新建草稿态 ───────────────────────────────────────────────────────────────

function NewChatDraft({
  agentName, onAgentChange, onCreated, agents,
}: {
  agentName: string; onAgentChange: (name: string) => void
  onCreated: (convId: string, firstMsg: string) => void; agents: AgentEntry[]
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
        body: JSON.stringify({ agentName, mode: 'chat', title: msg.slice(0, 30) }),
      })
      const data = await res.json()
      const convId: string = data.conversation?.id
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
      const res = await fetch(`/api/conversations/${id}`)
      if (res.ok) {
        const data = await res.json()
        setConv(data.conversation)
      } else {
        setConv(null)
        router.replace('/tasks', { scroll: false })
      }
    } catch {
      setConv(null)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    if (convIdParam) loadConv(convIdParam)
    else setConv(null)
  }, [convIdParam, loadConv])

  async function handleAgentChange(agentName: string) {
    setDraftAgent(agentName)
    if (!conv) return
    try {
      const res = await fetch(`/api/conversations/${conv.id}/agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      })
      if (res.ok) setConv((await res.json()).conversation)
    } catch { }
  }

  function handleConvCreated(convId: string, firstMsg: string) {
    sessionStorage.setItem(`manta:pending-msg:${convId}`, firstMsg)
    router.replace(`/tasks?convId=${convId}`, { scroll: false })
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>加载中…</p>
      </div>
    )
  }

  if (conv) {
    const initialMessages: UIMessage[] = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
        metadata: undefined,
      }))

    return (
      <ChatView
        key={conv.id}
        convId={conv.id}
        agentName={conv.agentName}
        initialMessages={initialMessages}
        title={conv.title}
        onAgentChange={handleAgentChange}
        onNewChat={() => { setConv(null); router.replace('/tasks', { scroll: false }) }}
        agents={agents}
      />
    )
  }

  return (
    <NewChatDraft
      agentName={draftAgent}
      onAgentChange={setDraftAgent}
      onCreated={handleConvCreated}
      agents={agents}
    />
  )
}

export default function TasksPageWrapper() {
  return (
    <Suspense fallback={
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>加载中…</p>
      </div>
    }>
      <TasksPage />
    </Suspense>
  )
}
