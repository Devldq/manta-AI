import { useMemo, useState, memo } from 'react'
import type { UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createMarkdownComponents } from '../utils/markdown'
import { getTextContent, formatTime, fmtTokens } from '../utils/formatters'
import { ToolCallLog } from './ToolCallLog'
import { TokenBreakdown } from './TokenBreakdown'
import { useSmoothStreamingText } from './useSmoothStreamingText'
import type { StepUsageData } from '../utils/types'
import { getAgentRunSnapshot, isAgentRunTerminal } from '../runtime/agent-run-view'

const MarkdownContent = memo(function MarkdownContent({ content, streaming, onOpenFile }: { content: string; streaming?: boolean; onOpenFile?: (path: string) => void }) {
  const { text, revealing } = useSmoothStreamingText(content, Boolean(streaming))
  const components = useMemo(
    () => createMarkdownComponents({ onOpenFile, streaming: Boolean(streaming) }),
    [onOpenFile, streaming],
  )

  return (
    <div className={revealing ? 'streaming-markdown streaming-markdown--active' : 'streaming-markdown'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {text}
      </ReactMarkdown>
      {revealing && (
        <span className="streaming-caret" aria-hidden="true" />
      )}
    </div>
  )
})

interface MessageRowProps {
  message: UIMessage
  agentName: string
  isStreaming: boolean
  /** 流式期间实时收集的 step usage 数据（来自 SSE manta:step-usage 事件） */
  liveStepUsages?: StepUsageData[]
  onOpenFile?: (path: string) => void
}

export const MessageRow = memo(function MessageRow({ message, agentName, isStreaming, liveStepUsages, onOpenFile }: MessageRowProps) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tokenDetailOpen, setTokenDetailOpen] = useState(false)

  const content = getTextContent(message)
  const agentRun = useMemo(() => getAgentRunSnapshot(message.parts, message.metadata), [message.parts, message.metadata])
  const effectiveStreaming = agentRun ? !isAgentRunTerminal(agentRun) : isStreaming
  // 不再提取扁平工具调用列表，而是将 parts 传给 ToolCallLog
  const hasToolCalls = Boolean(agentRun) || message.parts.some(
    (p) =>
      p.type === 'dynamic-tool' ||
      (typeof p.type === 'string' && p.type.startsWith('tool-') && p.type !== 'tool-invocation')
  )
  // 工具步骤中的文本属于公开执行说明。只有运行结束后，最后正文才是任务总结。
  const visibleContent = hasToolCalls
    ? (effectiveStreaming ? '' : (agentRun?.summaryMarkdown || content))
    : content
  const hasVisibleContent = visibleContent.trim().length > 0

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
  const effectiveUsage = agentRun?.usage ?? metaUsage ?? (hasLive ? {
    inputTokens: liveStepUsages!.reduce((a, s) => a + s.inputTokens, 0),
    outputTokens: liveStepUsages!.reduce((a, s) => a + s.outputTokens, 0),
    cacheReadTokens: liveStepUsages!.reduce((a, s) => a + (s.cacheReadTokens ?? 0), 0) || undefined,
    cacheWriteTokens: liveStepUsages!.reduce((a, s) => a + (s.cacheWriteTokens ?? 0), 0) || undefined,
    noCacheTokens: liveStepUsages!.reduce((a, s) => a + (s.noCacheTokens ?? 0), 0) || undefined,
  } : undefined)

  // Token 是完成态元数据，不能在最终答复前抢先呈现为“结果”。
  const showTokenAnalysis = !effectiveStreaming && effectiveUsage && (effectiveUsage.inputTokens != null || effectiveUsage.outputTokens != null)
  const hasStepUsages = !effectiveStreaming && effectiveStepUsages && effectiveStepUsages.length > 1

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
        {hasToolCalls && (
          <ToolCallLog parts={message.parts} isStreaming={effectiveStreaming} agentRun={agentRun} onOpenFile={onOpenFile} />
        )}

        {/* 主内容区 */}
        {hasVisibleContent ? (
          <section
            className={hasToolCalls ? 'agent-task-summary' : undefined}
            aria-label={hasToolCalls ? '任务总结' : undefined}
            style={{ position: 'relative' }}
          >
            {hasToolCalls && <div className="agent-task-summary-title">任务总结</div>}
            {/* 复制按钮 */}
            {!effectiveStreaming && (
              <button onClick={handleCopy} style={{ position: 'absolute', top: 0, right: 0, opacity: hovered ? 0.45 : 0, transition: 'opacity 0.15s', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', zIndex: 2 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45' }}>
                {copied ? '✓' : '⧉'}
              </button>
            )}

            <div
              style={{ fontSize: '13px', lineHeight: '1.55', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}
            >
              <MarkdownContent content={visibleContent} streaming={effectiveStreaming} onOpenFile={onOpenFile} />
            </div>
          </section>
        ) : (
          <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
            {effectiveStreaming && !hasToolCalls ? (
              <span className="agent-thinking" aria-label="正在生成回复">
                <span className="agent-thinking-dot" />
                <span className="agent-thinking-dot" />
                <span className="agent-thinking-dot" />
              </span>
            ) : hasToolCalls ? null : '（无输出）'}
          </span>
        )}

        {/* 底部：仅在回复完成后显示 token 消耗 */}
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
                <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>· {fmtTokens(effectiveUsage.inputTokens + effectiveUsage.outputTokens)} total</span>
              )}
              {effectiveUsage.cacheReadTokens != null && effectiveUsage.cacheReadTokens > 0 && (
                <span style={{ fontSize: '9px', color: 'var(--color-text-success, #10b981)', fontFamily: 'var(--font-mono)' }}>cache hit {fmtTokens(effectiveUsage.cacheReadTokens)}</span>
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
