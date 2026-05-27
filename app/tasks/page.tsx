/* 会话聊天页面 — Impeccable 升级版 */
'use client'

import { useState, useEffect, useRef, Suspense, useCallback, memo } from 'react'
import {
  Folder, FileText, FileSearch, Search, Terminal, Pencil,
  Wrench, Loader2, Check, AlertCircle, ChevronDown, PanelRight,
  ArrowLeft,
} from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage, TextUIPart } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SessionSidebar } from '@/app/components/SessionSidebar'
import { useReconnectSSE } from '@/app/hooks/useReconnectSSE'

// ─── 类型 ──────────────────────────────────────────────────────────────────────

interface StoredToolCall {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: StoredToolCall[]
  usage?: { inputTokens?: number; outputTokens?: number }
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

interface AccessRequest {
  id: string
  path: string
  status: 'pending' | 'granted' | 'denied'
  requestedAt: number
}

const DEFAULT_AGENT = 'main'

// ─── 文件访问授权 Banner ───────────────────────────────────────────────────────

function useFsAccessRequests() {
  const [requests, setRequests] = useState<AccessRequest[]>([])

  useEffect(() => {
    const poll = () =>
      fetch('/api/fs/request-access')
        .then((r) => r.json())
        .then((data: AccessRequest[]) => setRequests(data))
        .catch(() => {})

    poll()
    const timer = setInterval(poll, 1500)
    return () => clearInterval(timer)
  }, [])

  async function respond(requestId: string, action: 'grant' | 'deny') {
    await fetch('/api/fs/grant-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, action }),
    })
    setRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  return { requests, respond }
}

function FsAccessBanner() {
  const { requests, respond } = useFsAccessRequests()
  if (requests.length === 0) return null

  return (
    <div style={{ padding: '0 20px 8px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {requests.map((req) => (
        <div key={req.id} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', borderRadius: '10px',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          fontSize: '13px',
          animation: 'tool-log-in var(--duration-fast) var(--ease-out-quart) both',
        }}>
          <span style={{ fontSize: '16px' }}>🔒</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
              Agent 申请访问目录
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {req.path}
            </div>
          </div>
          <button
            onClick={() => respond(req.id, 'grant')}
            className="transition-all duration-fast"
            style={{ padding: '5px 14px', borderRadius: '7px', border: 'none', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}>
            批准
          </button>
          <button
            onClick={() => respond(req.id, 'deny')}
            className="transition-all duration-fast"
            style={{ padding: '5px 14px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
            拒绝
          </button>
        </div>
      ))}
    </div>
  )
}

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

// ─── 工具调用日志 ──────────────────────────────────────────────────────────────

interface ToolCallEntry {
  toolCallId: string
  toolName: string
  state: string          // input-streaming | input-available | output-available | output-error
  input: unknown
  output: unknown
  errorText?: string
}

function extractToolCalls(parts: UIMessage['parts']): ToolCallEntry[] {
  if (!parts) return []
  const entries: ToolCallEntry[] = []
  for (const p of parts) {
    if (typeof p.type !== 'string') continue
    const isStaticTool = p.type.startsWith('tool-') && p.type !== 'tool-invocation'
    const isDynamic = p.type === 'dynamic-tool'
    if (!isStaticTool && !isDynamic) continue

    const cast = p as {
      type: string; toolName?: string; toolCallId: string
      state: string; input?: unknown; output?: unknown; errorText?: string
    }
    const toolName = isDynamic ? (cast.toolName ?? 'unknown') : p.type.replace(/^tool-/, '')
    entries.push({
      toolCallId: cast.toolCallId,
      toolName,
      state: cast.state,
      input: cast.input,
      output: cast.output,
      errorText: cast.errorText,
    })
  }
  return entries
}

/** 格式化工具输入/输出为可读字符串，截断过长内容 */
function formatValue(v: unknown, maxLen = 400): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '\n…（已截断）' : s
}

/** 工具名 → lucide icon 映射 */
const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  lsDir: Folder,
  readFile: FileText,
  glob: FileSearch,
  grep: Search,
  bash: Terminal,
  write: Pencil,
  edit: Pencil,
  multiEdit: Pencil,
}

/** 获取工具图标 */
function getToolIcon(toolName: string) {
  return TOOL_ICON_MAP[toolName] ?? Wrench
}

/** 把工具调用转成一句人读的动作描述 */
function describeToolCall(entry: ToolCallEntry): string {
  const input = entry.input as Record<string, unknown> | null | undefined
  switch (entry.toolName) {
    case 'bash': {
      const cmd = String(input?.command ?? '')
      const desc = input?.description ? ` (${input.description})` : ''
      // 显示命令，如果命令太长则截断
      const displayCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd
      return `执行命令: ${displayCmd}${desc}`
    }
    case 'lsDir': {
      const p = String(input?.dir_path ?? '')
      return `列出目录 ${p}`
    }
    case 'readFile': {
      const p = String(input?.file_path ?? '')
      return `读取文件 ${p}`
    }
    case 'glob': {
      const pat = String(input?.pattern ?? '')
      const root = input?.path ? ` (${input.path})` : ''
      return `匹配文件 ${pat}${root}`
    }
    case 'grep': {
      const pat = String(input?.pattern ?? '')
      const sp = input?.search_path ? ` 在 ${input.search_path}` : ''
      return `搜索 "${pat}"${sp}`
    }
    default:
      return entry.toolName
  }
}

const TOOL_LOG_MAX = 5   // 超过此数量折叠

const ToolCallLog = memo(function ToolCallLog({
  toolCalls,
}: {
  toolCalls: ToolCallEntry[]
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  if (toolCalls.length === 0) return null

  const hasActive = toolCalls.some(
    (t) => t.state === 'input-streaming' || t.state === 'input-available'
  )
  const errorCount = toolCalls.filter((t) => t.state === 'output-error').length
  const needFold = toolCalls.length > TOOL_LOG_MAX
  const visible = needFold && !expanded ? toolCalls.slice(-TOOL_LOG_MAX) : toolCalls
  const hiddenCount = toolCalls.length - TOOL_LOG_MAX

  return (
    <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {/* 折叠提示行 */}
      {needFold && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '3px 6px', border: 'none', background: 'transparent',
            cursor: 'pointer', textAlign: 'left', borderRadius: '4px',
            color: 'var(--color-text-muted)', fontSize: '11px',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
        >
          <ChevronDown size={12} />
          <span style={{ fontFamily: 'var(--font-mono)' }}>还有 {hiddenCount} 条工具调用</span>
        </button>
      )}

      {/* 日志行 */}
      {visible.map((t, i) => (
        <ToolCallItem key={t.toolCallId ?? i} entry={t} />
      ))}

      {/* 折叠收起 */}
      {needFold && expanded && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '3px 6px', border: 'none', background: 'transparent',
            cursor: 'pointer', textAlign: 'left', borderRadius: '4px',
            color: 'var(--color-text-muted)', fontSize: '11px',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
        >
          <ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />
          <span style={{ fontFamily: 'var(--font-mono)' }}>收起</span>
        </button>
      )}

      {/* 执行中尾行汇总（仅在折叠时展示当前动作） */}
      {hasActive && needFold && !expanded && (() => {
        const active = toolCalls.find(t => t.state === 'input-streaming' || t.state === 'input-available')
        if (!active) return null
        return null // visible 里已包含最新的
      })()}

      {/* 无错时无需额外状态行；有错时在最后加一行 */}
      {!hasActive && errorCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 6px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-status-failed)', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: 'var(--color-status-failed)', fontFamily: 'var(--font-mono)' }}>{errorCount} 个调用失败</span>
        </div>
      )}
    </div>
  )
})

const ToolCallItem = memo(function ToolCallItem({ entry }: { entry: ToolCallEntry }) {
  const isActive = entry.state === 'input-streaming' || entry.state === 'input-available'
  const isDone = entry.state === 'output-available'
  const isError = entry.state === 'output-error'
  const desc = describeToolCall(entry)
  const IconComponent = getToolIcon(entry.toolName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '2px 6px', borderRadius: '4px',
      minHeight: '22px',
    }}>
      {/* 状态图标 */}
      {isActive ? (
        <Loader2 size={13} className="tool-spinner" style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
      ) : isDone ? (
        <Check size={13} style={{ flexShrink: 0, color: 'var(--color-status-done)' }} />
      ) : isError ? (
        <AlertCircle size={13} style={{ flexShrink: 0, color: 'var(--color-status-failed)' }} />
      ) : (
        <IconComponent size={13} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
      )}

      {/* 动作描述 */}
      <span style={{
        fontSize: '12px', fontFamily: 'var(--font-mono)',
        color: isActive ? 'var(--color-text-secondary)' : isError ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {desc}
      </span>
    </div>
  )
})

// ─── 消息行 ────────────────────────────────────────────────────────────────────

/** 格式化 token 数：≥10000 显示为 x.xw */
function fmtTokens(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return String(n)
}

/** 格式化时间戳为 HH:mm */
function formatTime(ts: string | undefined): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return '' }
}

/** 内容字符数超过此阈值时加滚动窗口 */
const CONTENT_SCROLL_THRESHOLD = 1200

const MessageRow = memo(function MessageRow({ message, agentName, isStreaming }: { message: UIMessage; agentName: string; isStreaming: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const content = getTextContent(message)
  const toolCalls = extractToolCalls(message.parts)
  const meta = message.metadata as { timestamp?: string; usage?: { inputTokens?: number; outputTokens?: number } | null } | undefined
  const timestamp = formatTime(meta?.timestamp)
  const usage = meta?.usage
  const isLong = content.length > CONTENT_SCROLL_THRESHOLD

  async function handleCopy() {
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { }
  }

  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={handleCopy} style={{ opacity: hovered ? 0.5 : 0, transition: 'opacity 0.15s', width: '22px', height: '22px', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '11px', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5' }}>
            {copied ? '✓' : '⧉'}
          </button>
          <div style={{ maxWidth: '72%', padding: '10px 16px', borderRadius: '16px', fontSize: '14px', lineHeight: '1.65', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', transition: 'transform var(--duration-fast) var(--ease-out-quart)' }}>
            {content}
          </div>
        </div>
        {timestamp && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', paddingRight: '30px' }}>{timestamp}</span>
        )}
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
        {/* 顶部：agent 名 + 时间 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{agentName}</span>
          {timestamp && <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{timestamp}</span>}
        </div>

        {/* 工具调用日志 */}
        {toolCalls.length > 0 && (
          <ToolCallLog toolCalls={toolCalls} isStreaming={isStreaming} />
        )}

        {/* 主内容区 */}
        {content
          ? (
            <div style={{ position: 'relative' }}>
              {/* 复制按钮 */}
              {!isStreaming && (
                <button onClick={handleCopy} style={{ position: 'absolute', top: 0, right: 0, opacity: hovered ? 0.5 : 0, transition: 'opacity 0.15s', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', zIndex: 2 }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5' }}>
                  {copied ? '✓' : '⧉'}
                </button>
              )}

              {/* 内容：超长且已结束时折叠 */}
              <div
                className={isLong && !isStreaming && !expanded ? 'msg-content-collapsed' : undefined}
                style={{ fontSize: '14px', lineHeight: '1.65', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
              >
                <MarkdownContent content={content} streaming={isStreaming} />
              </div>

              {/* 展开/收起按钮 */}
              {isLong && !isStreaming && (
                <div style={{ marginTop: expanded ? '10px' : '2px', display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={() => setExpanded(v => !v)}
                    className="transition-all duration-fast"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '5px 14px', borderRadius: '20px', fontSize: '12px',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-accent-subtle)'
                      e.currentTarget.style.borderColor = 'var(--color-accent)'
                      e.currentTarget.style.color = 'var(--color-accent)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--color-surface)'
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.color = 'var(--color-text-secondary)'
                    }}
                  >
                    <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform var(--duration-normal) var(--ease-out-quart)', fontSize: '10px', lineHeight: 1 }}>▼</span>
                    {expanded ? '收起' : '展开全文'}
                  </button>
                </div>
              )}
            </div>
          )
          : (
            <span style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
              {isStreaming
                ? <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--color-accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} />
                : toolCalls.length > 0 ? null : '（无输出）'}
            </span>
          )
        }

        {/* 底部：token 消耗 */}
        {!isStreaming && usage && (usage.inputTokens != null || usage.outputTokens != null) && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {usage.inputTokens != null && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>in {fmtTokens(usage.inputTokens)}</span>
            )}
            {usage.outputTokens != null && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>out {fmtTokens(usage.outputTokens)}</span>
            )}
            {usage.inputTokens != null && usage.outputTokens != null && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>· {fmtTokens(usage.inputTokens + usage.outputTokens)} total</span>
            )}
          </div>
        )}
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
  const [modelOpen, setModelOpen] = useState(false)
  const modelDropRef = useRef<HTMLDivElement>(null)
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [activeProfileId, setActiveProfileId] = useState<string>('')

  // 获取模型配置列表
  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/chat/config')
        const data = await res.json()
        if (data.profiles) {
          setProfiles(data.profiles.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
          setActiveProfileId(data.activeProfileId || data.profiles[0]?.id || '')
        }
      } catch (err) {
        console.error('Failed to fetch profiles:', err)
      }
    }
    fetchProfiles()
  }, [])

  // 切换模型
  async function handleModelChange(profileId: string) {
    try {
      await fetch('/api/chat/config?action=active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      setActiveProfileId(profileId)
      setModelOpen(false)
    } catch (err) {
      console.error('Failed to switch model:', err)
    }
  }

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

  useEffect(() => {
    if (!modelOpen) return
    function outside(e: MouseEvent) {
      if (modelDropRef.current && !modelDropRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [modelOpen])

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
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow var(--duration-normal) var(--ease-out-quart), border-color var(--duration-normal) var(--ease-out-quart)',
      }}>
        {/* 顶部工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 14px 0' }}>
          <button className="transition-all duration-fast"
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title="@提及">
            @
          </button>
          <button className="transition-all duration-fast"
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
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
          placeholder="输入消息…"
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
          {/* 左侧：模型 / Auto / Skills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* 模型选择器 */}
            <div ref={modelDropRef} style={{ position: 'relative' }}>
              <button
                onClick={() => !disabled && setModelOpen((o) => !o)}
                className="transition-all duration-fast"
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                  background: modelOpen ? 'var(--color-accent-subtle)' : 'transparent',
                  color: modelOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  cursor: disabled ? 'default' : 'pointer', fontSize: '12px', fontWeight: 500,
                }}
                onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' } }}
                onMouseLeave={(e) => { if (!disabled && !modelOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
              >
                <span style={{ fontSize: '12px' }}>◎</span>
                <span>{profiles.find(p => p.id === activeProfileId)?.name || '选择模型'}</span>
                <span style={{ fontSize: '9px', opacity: 0.6, transition: 'transform var(--duration-fast) var(--ease-out-quart)', transform: modelOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
              </button>
              {modelOpen && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: '180px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                  {profiles.length === 0
                    ? <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>暂无模型</div>
                    : profiles.map((p) => (
                      <button key={p.id} onClick={() => handleModelChange(p.id)}
                        className="transition-colors duration-fast"
                        style={{ width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: p.id === activeProfileId ? 'var(--color-accent-subtle)' : 'transparent', color: 'var(--color-text-primary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onMouseEnter={(e) => { if (p.id !== activeProfileId) e.currentTarget.style.background = 'var(--color-border)' }}
                        onMouseLeave={(e) => { if (p.id !== activeProfileId) e.currentTarget.style.background = 'transparent' }}>
                        {p.id === activeProfileId && <span style={{ color: 'var(--color-accent)', fontSize: '10px' }}>✓</span>}
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{p.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            <button className="transition-all duration-fast"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              <span style={{ fontSize: '11px' }}>⚡</span>
              <span>Auto</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
            </button>

            <button className="transition-all duration-fast"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              <span style={{ fontSize: '11px' }}>✦</span>
              <span>Skills</span>
            </button>
          </div>

          {/* 右侧：选择文件夹 + 发送 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button className="transition-all duration-fast"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              <span style={{ fontSize: '11px' }}>🖥</span>
              <span>选择文件夹</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
            </button>

            {isLoading ? (
              <button onClick={onStop}
                className="transition-all duration-fast"
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-status-failed)', background: 'transparent', color: 'var(--color-status-failed)', cursor: 'pointer', fontSize: '13px', transition: 'all var(--duration-fast) var(--ease-out-quart)' }}>
                ⏹
              </button>
            ) : (
              <button onClick={onSubmit} disabled={!value.trim() || disabled}
                className="transition-all duration-fast"
                style={{
                  width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none',
                  background: value.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                  color: value.trim() ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                  cursor: value.trim() && !disabled ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  transform: value.trim() && !disabled ? 'scale(1)' : 'scale(1)',
                  boxShadow: value.trim() && !disabled ? '0 2px 8px rgba(0, 158, 106, 0.25)' : 'none',
                }}
                onMouseEnter={(e) => { if (value.trim() && !disabled) e.currentTarget.style.transform = 'scale(1.05)' }}
                onMouseLeave={(e) => { if (value.trim() && !disabled) e.currentTarget.style.transform = 'scale(1)' }}>
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
      {/* 蝠鲼图标 */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ width: '160px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* SVG 动漫风蝠鲼 — 仰视角，右翼上翻，嘴大张，带海浪 */}
          <svg width="160" height="130" viewBox="0 0 160 130" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.85 }}>

            {/* ── 海浪（底部）── */}
            <path d="M0 114 C22 107, 40 121, 62 114 C84 107, 104 121, 130 114 C142 110, 152 117, 160 114"
              stroke="currentColor" strokeWidth="1.4" opacity="0.35" fill="none" strokeLinecap="round"/>
            <path d="M0 123 C18 117, 34 128, 55 122 C66 119, 72 124, 80 121 C96 116, 118 127, 140 121 C150 118, 156 124, 160 122"
              stroke="currentColor" strokeWidth="1.8" opacity="0.5" fill="none" strokeLinecap="round"/>

            {/* ── 身体主轮廓（仰视，菱形腹面）── */}
            <path d="M80 38 C92 42, 102 52, 104 64 C106 76, 98 86, 82 90 C66 94, 52 88, 46 76 C40 64, 46 50, 58 44 C64 41, 72 38, 80 38Z"
              stroke="currentColor" strokeWidth="1.8" fill="none"/>

            {/* ── 右翼（向右上大幅翻卷，动感强）── */}
            <path d="M100 52 C114 40, 130 24, 148 14 C153 11, 156 15, 152 20 C140 34, 120 48, 108 58"
              stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            {/* 右翼下缘回线 */}
            <path d="M104 68 C118 62, 136 54, 148 46 C152 44, 153 48, 150 52 C138 62, 118 70, 104 72"
              stroke="currentColor" strokeWidth="1.3" opacity="0.55" fill="none" strokeLinecap="round"/>

            {/* ── 左翼（平展向左，略向上）── */}
            <path d="M56 50 C42 44, 24 38, 8 36 C4 35, 4 39, 8 42 C22 48, 42 54, 56 58"
              stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            {/* 左翼下缘 */}
            <path d="M50 70 C36 66, 20 62, 8 60 C4 59, 4 63, 8 65 C20 68, 36 72, 50 74"
              stroke="currentColor" strokeWidth="1.3" opacity="0.55" fill="none" strokeLinecap="round"/>

            {/* ── 头鳍（两根标志性卷角，向前张开）── */}
            {/* 左头鳍 */}
            <path d="M66 42 C60 32, 56 22, 58 14 C59 10, 63 11, 64 16 C65 22, 66 32, 68 40"
              stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            {/* 右头鳍 */}
            <path d="M92 44 C98 34, 102 22, 100 14 C99 10, 95 11, 94 16 C93 22, 91 32, 90 42"
              stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>

            {/* ── 嘴巴大张（半圆形，仰视看到内部）── */}
            <path d="M64 72 C66 80, 72 84, 80 84 C88 84, 94 80, 96 72"
              stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
            {/* 嘴巴上缘 */}
            <path d="M64 72 C68 68, 74 66, 80 66 C86 66, 92 68, 96 72"
              stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
            {/* 嘴内腮弧 */}
            <path d="M68 76 C72 80, 78 82, 80 82 C82 82, 88 80, 92 76"
              stroke="currentColor" strokeWidth="0.9" opacity="0.4" fill="none" strokeLinecap="round"/>

            {/* ── 眼睛（腹面两侧，偏上）── */}
            <circle cx="66" cy="58" r="3" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            <circle cx="66" cy="58" r="1.2" fill="currentColor"/>
            <circle cx="94" cy="58" r="3" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            <circle cx="94" cy="58" r="1.2" fill="currentColor"/>
            {/* 高光 */}
            <circle cx="67" cy="57" r="0.7" fill="currentColor" opacity="0.5"/>
            <circle cx="95" cy="57" r="0.7" fill="currentColor" opacity="0.5"/>

            {/* ── 尾巴（向左下细长甩出）── */}
            <path d="M50 80 C40 88, 28 96, 18 104 C14 107, 12 104, 16 101 C24 96, 36 88, 46 80"
              stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>

            {/* ── 腹面纹路（中线 + 弧线）── */}
            <path d="M80 42 L80 86" stroke="currentColor" strokeWidth="0.8" opacity="0.2" strokeLinecap="round"/>
            <path d="M60 56 C68 60, 74 62, 80 62 C86 62, 92 60, 100 56"
              stroke="currentColor" strokeWidth="0.8" opacity="0.2" fill="none"/>

            {/* ── 水花（从身体周围溅起）── */}
            <path d="M106 74 C110 68, 114 66, 114 72" stroke="currentColor" strokeWidth="1" opacity="0.4" fill="none" strokeLinecap="round"/>
            <path d="M112 80 C118 76, 122 76, 120 82" stroke="currentColor" strokeWidth="0.9" opacity="0.35" fill="none" strokeLinecap="round"/>
            <path d="M44 76 C40 70, 36 70, 38 76" stroke="currentColor" strokeWidth="1" opacity="0.4" fill="none" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      {/* 标题 */}
      <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '8px', letterSpacing: '-0.02em', textAlign: 'center', lineHeight: 1.3 }}>
        Claw Your Ideas Into Reality
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-text-muted)', marginBottom: '40px', textAlign: 'center', lineHeight: 1.5 }}>
        Triggered Anywhere, Completed Locally
      </p>


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
            className="transition-all duration-fast"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
              padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
              fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            <span>{tag.icon}</span>
            <span>{tag.label}</span>
          </button>
        ))}
      </div>
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
  convId, agentName, initialMessages, onAgentChange, onNewChat, title, agents, conversation,
}: {
  convId: string; agentName: string; initialMessages: UIMessage[]
  onAgentChange: (name: string) => void; onNewChat: () => void; title: string; agents: AgentEntry[]
  conversation: Conversation | null
}) {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [inputText, setInputText] = useState('')
  // 本地 conversation 状态：初始值来自父组件，流式结束后从 API 刷新同步更新
  const [sidebarConv, setSidebarConv] = useState<Conversation | null>(conversation)
  useEffect(() => { setSidebarConv(conversation) }, [conversation])
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
      api: `/api/conversations/${convId}/ai-stream`,
      body: { agentName },
    }),
    messages: initialMessages,
    id: convId,
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // ─── SSE 重连：页面刷新 / 切换回有活跃循环的会话时自动重连 ─────────────────
  const reconnect = useReconnectSSE(convId, !isLoading && status === 'ready')

  // 当发送新消息时，重置重连状态（新的 loop 会通过 POST 启动）
  useEffect(() => {
    if (isLoading) {
      reconnect.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])

  // 当重连流结束时，从 API 重新加载完整消息（含 metadata）
  const reconnectFinishedRef = useRef(false)
  useEffect(() => {
    if (reconnect.finished && !reconnectFinishedRef.current) {
      reconnectFinishedRef.current = true
      fetch(`/api/conversations/${convId}`)
        .then((r) => r.json())
        .then((data) => {
          const conv = data.conversation
          if (!conv) return
          setSidebarConv(conv)
          const refreshed: UIMessage[] = conv.messages
            .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
            .map((m: { id: string; role: string; content: string; timestamp: string; toolCalls?: unknown[]; usage?: { inputTokens?: number; outputTokens?: number } | null }) => {
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
                metadata: { timestamp: m.timestamp, usage: m.usage ?? null },
              }
            })
          setMessages(refreshed)
          // 清除重连状态，避免 streamingParts 残留导致 displayMessages 重复
          reconnect.reset()
        })
        .catch(() => { })
    }
  }, [reconnect.finished, convId, setMessages, reconnect])

  // 持久化 sidebarOpen 到 localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen))
  }, [sidebarOpen])

  // 流结束后从服务端重新加载消息（以获取 metadata：timestamp、usage）
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if ((prev === 'streaming' || prev === 'submitted') && status === 'ready') {
      fetch(`/api/conversations/${convId}`)
        .then((r) => r.json())
        .then((data) => {
          const conv = data.conversation
          if (!conv) return
          // 同步更新侧边栏的 conversation 数据（含 toolCall 记录）
          setSidebarConv(conv)
          const refreshed: UIMessage[] = conv.messages
            .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
            .map((m: { id: string; role: string; content: string; timestamp: string; toolCalls?: unknown[]; usage?: { inputTokens?: number; outputTokens?: number } | null }) => {
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
                metadata: { timestamp: m.timestamp, usage: m.usage ?? null },
              }
            })
          setMessages(refreshed)
        })
        .catch(() => { })
    }
  }, [status, convId, setMessages])

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
    // 发送新消息时重置重连标记
    reconnectFinishedRef.current = false
    reconnect.reset()
    const msg = inputText.trim()
    if (!msg || isLoading) return
    setInputText('')
    sendMessage({ text: msg })
  }

  // ─── 自定义停止：调用专用 stop API 停止后台 loop ────────────────────────────
  async function handleStop() {
    // 先调用 stop API 停止后台 agent loop
    await fetch(`/api/conversations/${convId}/stop`, { method: 'POST' }).catch(() => {})
    // 再调用 useChat 的 stop（中断前端 fetch）
    stop()
  }

  // ─── 合并重连流式内容到消息列表 ────────────────────────────────────────────
  const hasReconnectContent = reconnect.connected && reconnect.streamingParts.length > 0
  // 记录被替换的消息在 displayMessages 中的索引，用于正确的 streaming 标识
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
          // 用重连内容替换最后一条 assistant 的 parts（保留原 id 以维持 React key 稳定）
          result[lastAssistantIdx] = {
            ...result[lastAssistantIdx],
            parts: reconnect.streamingParts,
          }
          replacedMsgIdxRef.current = lastAssistantIdx
        } else {
          // 没有已有的 assistant 消息 → 追加新消息（标记为 reconnect 消息）
          result.push({
            id: `reconnect-${convId}`,
            role: 'assistant' as const,
            parts: reconnect.streamingParts,
            createdAt: new Date(),
          })
          replacedMsgIdxRef.current = result.length - 1
        }
        return result
      })()
    : (replacedMsgIdxRef.current = -1, messages)

  // 重连中的 loading 态（有活跃循环但还没收到 chunk）
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
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px' }} title={title}>
              {title}
            </h3>
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
              title={sidebarOpen ? '关闭会话详情' : '打开会话详情'}>
              <PanelRight size={14} />
              <span>{sidebarOpen ? '隐藏' : '详情'}</span>
            </button>
            <button onClick={onNewChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-fast"
              style={{ border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              + 新对话
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
            const isLastAssistant = msg.role === 'assistant' && (idx === displayMessages.length - 1)
            const streaming = isReconnectMsg
              ? showReconnectStreaming
              : (isLoading && isLastAssistant)
            return <div key={msg.id} style={{ width: '100%' }}>
              <MessageRow message={msg} agentName={agentName} isStreaming={streaming} />
            </div>
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

      {/* 会话侧边栏 */}
      <SessionSidebar
        open={sidebarOpen}
        conversation={sidebarConv}
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
      .map((m) => {
        const parts: UIMessage['parts'] = []

        // 把持久化的工具调用记录还原为 dynamic-tool parts（output-available 状态）
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

        // 文本内容
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
        onNewChat={() => { setConv(null); router.replace('/tasks', { scroll: false }) }}
        agents={agents}
        conversation={conv}
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
