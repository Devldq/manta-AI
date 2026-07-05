import { useState, memo } from 'react'
import type { UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from '../utils/markdown'
import { getTextContent, formatTime, fmtTokens } from '../utils/formatters'
import { ToolCallLog } from './ToolCallLog'
import { TokenBreakdown } from './TokenBreakdown'
import type { StepUsageData } from '../utils/types'

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
        <span style={{ display: 'inline-block', width: '2px', height: '13px', background: 'var(--color-accent)', marginLeft: '2px', verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
      )}
    </div>
  )
})

interface MessageRowProps {
  message: UIMessage
  agentName: string
  isStreaming: boolean
  /** 是否是最后一条 assistant 消息（用于自动折叠历史消息） */
  isLastAssistant?: boolean
  /** 流式期间实时收集的 step usage 数据（来自 SSE manta:step-usage 事件） */
  liveStepUsages?: StepUsageData[]
}

export const MessageRow = memo(function MessageRow({ message, agentName, isStreaming, isLastAssistant = true, liveStepUsages }: MessageRowProps) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(isLastAssistant) // 历史消息默认折叠工具调用
  const [tokenDetailOpen, setTokenDetailOpen] = useState(false)

  const content = getTextContent(message)
  // 不再提取扁平工具调用列表，而是将 parts 传给 ToolCallLog
  const hasToolCalls = message.parts.some(
    (p) =>
      p.type === 'dynamic-tool' ||
      (typeof p.type === 'string' && p.type.startsWith('tool-') && p.type !== 'tool-invocation')
  )

  const meta = message.metadata as {
    timestamp?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
    } | null
    stepUsages?: Array<{
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
      toolNames?: string[]
    }> | null
  } | undefined

  const timestamp = formatTime(meta?.timestamp)

  // ── 计算有效的 usage 和 stepUsages ──
  // 优先使用 metadata 中的完整数据（loop 结束后从服务端获取）
  // 如果没有（流式期间），则从 liveStepUsages 实时数据中计算
  const metaUsage = meta?.usage
  const metaStepUsages = meta?.stepUsages

  const hasLive = liveStepUsages && liveStepUsages.length > 0
  const effectiveStepUsages = metaStepUsages ?? (hasLive ? liveStepUsages : undefined)
  const effectiveUsage = metaUsage ?? (hasLive ? {
    inputTokens: liveStepUsages!.reduce((a, s) => a + s.inputTokens, 0),
    outputTokens: liveStepUsages!.reduce((a, s) => a + s.outputTokens, 0),
    cacheReadTokens: liveStepUsages!.reduce((a, s) => a + (s.cacheReadTokens ?? 0), 0) || undefined,
    cacheWriteTokens: liveStepUsages!.reduce((a, s) => a + (s.cacheWriteTokens ?? 0), 0) || undefined,
    noCacheTokens: liveStepUsages!.reduce((a, s) => a + (s.noCacheTokens ?? 0), 0) || undefined,
  } : undefined)

  // Token 分析的显示条件：
  // - 非流式：有 usage 数据就显示（和原来一样）
  // - 流式：有 live step usages 就显示（不等 loop 结束）
  const showTokenAnalysis = effectiveUsage && (effectiveUsage.inputTokens != null || effectiveUsage.outputTokens != null)
  // 分步面板：非流式时 >1 步才显示，流式时 ≥1 步就显示（实时查看进度）
  const hasStepUsages = effectiveStepUsages && (isStreaming ? effectiveStepUsages.length >= 1 : effectiveStepUsages.length > 1)

  // 判断是否是已完成的历史消息（非最后一条 assistant，且非流式）
  const isHistorical = !isLastAssistant && !isStreaming

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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={handleCopy} style={{ opacity: hovered ? 0.45 : 0, transition: 'opacity 0.15s', width: '20px', height: '20px', marginTop: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '10px', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45' }}>
            {copied ? '✓' : '⧉'}
          </button>
          <div style={{ maxWidth: '82%', padding: '7px 12px', borderRadius: '12px', fontSize: '13px', lineHeight: '1.5', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', transition: 'transform var(--duration-fast) var(--ease-out-quart)' }}>
            {content}
          </div>
        </div>
        {timestamp && (
          <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', paddingRight: '24px' }}>{timestamp}</span>
        )}
      </div>
    )
  }

  const avatarLabel = (agentName || 'A').slice(0, 1).toUpperCase()

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, background: 'var(--color-accent)', color: '#000', marginTop: '1px' }}>
        {avatarLabel}
      </div>
      <div style={{ flex: 1, minWidth: 0, maxWidth: '78ch' }}>
        {/* 顶部：agent 名 + 时间 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
          <span style={{ fontSize: '10.5px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{agentName}</span>
          {timestamp && <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>{timestamp}</span>}
        </div>

        {/* 工具调用日志（步骤视图） */}
        {hasToolCalls && (toolsExpanded || isLastAssistant) && (
          <ToolCallLog parts={message.parts} isStreaming={isStreaming} />
        )}

        {/* 历史消息：折叠的工具调用摘要 */}
        {hasToolCalls && isHistorical && toolsExpanded && (
          <button
            onClick={() => setToolsExpanded(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 6px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', borderRadius: '10px',
              cursor: 'pointer', fontSize: '10px', color: 'var(--color-text-muted)',
              marginBottom: '6px',
            }}
          >
            <span>收起工具调用</span>
          </button>
        )}

        {/* 历史消息：折叠状态时显示展开按钮 */}
        {hasToolCalls && isHistorical && !toolsExpanded && (
          <button
            onClick={() => setToolsExpanded(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '3px',
              padding: '2px 6px', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', borderRadius: '10px',
              cursor: 'pointer', fontSize: '10px', color: 'var(--color-text-muted)',
              marginBottom: '6px',
            }}
          >
            <span>🔧 查看工具调用</span>
          </button>
        )}

        {/* 主内容区 */}
        {content ? (
          <div style={{ position: 'relative' }}>
            {/* 复制按钮 */}
            {!isStreaming && (
              <button onClick={handleCopy} style={{ position: 'absolute', top: 0, right: 0, opacity: hovered ? 0.45 : 0, transition: 'opacity 0.15s', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', zIndex: 2 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45' }}>
                {copied ? '✓' : '⧉'}
              </button>
            )}

            <div
              style={{ fontSize: '13px', lineHeight: '1.55', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
            >
              <MarkdownContent content={content} streaming={isStreaming} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            {isStreaming ? (
              <span style={{ display: 'inline-block', width: '2px', height: '13px', background: 'var(--color-accent)', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }} />
            ) : hasToolCalls ? null : '（无输出）'}
          </span>
        )}

        {/* 底部：token 消耗（流式期间也显示实时数据） */}
        {showTokenAnalysis && (
          <div style={{ marginTop: '6px' }}>
            {/* 紧凑摘要行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {effectiveUsage.inputTokens != null && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>in {fmtTokens(effectiveUsage.inputTokens)}</span>
              )}
              {effectiveUsage.outputTokens != null && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>out {fmtTokens(effectiveUsage.outputTokens)}</span>
              )}
              {effectiveUsage.inputTokens != null && effectiveUsage.outputTokens != null && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>· {fmtTokens(effectiveUsage.inputTokens + effectiveUsage.outputTokens + (effectiveUsage.cacheReadTokens ?? 0))} total</span>
              )}
              {effectiveUsage.cacheReadTokens != null && effectiveUsage.cacheReadTokens > 0 && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-success, #10b981)', fontFamily: 'var(--font-mono)' }}>cache hit {fmtTokens(effectiveUsage.cacheReadTokens)}</span>
              )}
              {/* 流式期间的实时指示 */}
              {isStreaming && hasLive && (
                <span style={{ fontSize: '9px', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-accent)', display: 'inline-block', animation: 'pulse-soft 1.5s ease-in-out infinite' }} />
                  live
                </span>
              )}
            </div>

            {/* 分步分析面板 */}
            {hasStepUsages && (
              <TokenBreakdown
                steps={effectiveStepUsages!}
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
