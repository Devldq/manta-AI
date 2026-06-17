'use client'

import { useState, memo } from 'react'
import type { UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from '../utils/markdown'
import { getTextContent, extractToolCalls, formatTime, fmtTokens } from '../utils/formatters'
import { ToolCallLog } from './ToolCallLog'
import { TokenBreakdown } from './TokenBreakdown'

/** 内容字符数超过此阈值时加滚动窗口 */
const CONTENT_SCROLL_THRESHOLD = 1200

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

export const MessageRow = memo(function MessageRow({ message, agentName, isStreaming }: { message: UIMessage; agentName: string; isStreaming: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [tokenDetailOpen, setTokenDetailOpen] = useState(false)
  const content = getTextContent(message)
  const toolCalls = extractToolCalls(message.parts)
  const meta = message.metadata as { timestamp?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number } | null; stepUsages?: Array<{ inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number; toolNames?: string[] }> | null } | undefined
  const timestamp = formatTime(meta?.timestamp)
  const usage = meta?.usage
  const stepUsages = meta?.stepUsages
  const hasStepUsages = stepUsages && stepUsages.length > 1 // 只有多步才展示分析面板
  const isLong = content.length > CONTENT_SCROLL_THRESHOLD

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 忽略错误
    }
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
        {content ? (
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
                  onClick={() => setExpanded((v) => !v)}
                  className="transition-all duration-fast"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '5px 14px', borderRadius: '20px', fontSize: '12px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-accent-subtle)'
                    e.currentTarget.style.borderColor = 'var(--color-accent)'
                    e.currentTarget.style.color = 'var(--color-accent)'
                  }}
                  onMouseLeave={(e) => {
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
        ) : (
          <span style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
            {isStreaming ? (
              <span style={{ display: 'inline-block', width: '2px', height: '14px', background: 'var(--color-accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} />
            ) : toolCalls.length > 0 ? null : '（无输出）'}
          </span>
        )}

        {/* 底部：token 消耗 */}
        {!isStreaming && usage && (usage.inputTokens != null || usage.outputTokens != null) && (
          <div style={{ marginTop: '10px' }}>
            {/* 紧凑摘要行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {usage.inputTokens != null && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>in {fmtTokens(usage.inputTokens)}</span>
              )}
              {usage.outputTokens != null && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>out {fmtTokens(usage.outputTokens)}</span>
              )}
              {usage.inputTokens != null && usage.outputTokens != null && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>· {fmtTokens(usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0))} total</span>
              )}
              {usage.cacheReadTokens != null && usage.cacheReadTokens > 0 && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-success, #10b981)', fontFamily: 'var(--font-mono)' }}>cache hit {fmtTokens(usage.cacheReadTokens)}</span>
              )}
            </div>

            {/* 分步分析面板（仅多步时显示） */}
            {hasStepUsages && (
              <TokenBreakdown
                steps={stepUsages!}
                open={tokenDetailOpen}
                onToggle={() => setTokenDetailOpen((v) => !v)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
})
