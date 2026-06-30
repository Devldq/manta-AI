import { memo, useState, useRef, useEffect } from 'react'
import { Loader2, Check, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type { StepGroup, ToolCallEntry } from '../utils/types'

// ============================================================
// 样式常量
// ============================================================
const THINK_COLOR = '#6366f1'
const DONE_COLOR = '#22c55e'
const ERR_COLOR = '#ef4444'
const RUN_COLOR = '#3b82f6'
const FADED = 'var(--color-text-muted)'

// ============================================================
// 动作描述
// ============================================================
function describeAction(entry: ToolCallEntry): string {
  const input = entry.input as Record<string, unknown> | null | undefined
  switch (entry.toolName) {
    case 'bash': {
      const cmd = String(input?.command ?? '')
      return cmd.length > 50 ? cmd.slice(0, 50) + '…' : cmd
    }
    case 'lsDir': return `已查看 ${String(input?.dir_path ?? '')}`
    case 'readFile': return `已读取 ${String(input?.file_path ?? '')}`
    case 'glob': return `已搜索 ${String(input?.pattern ?? '')}`
    case 'grep': return `已搜索 "${String(input?.pattern ?? '')}"`
    case 'write': return `已写入 ${String(input?.file_path ?? '')}`
    case 'edit':
    case 'multiEdit': return `已编辑 ${String(input?.file_path ?? '')}`
    default: return entry.toolName
  }
}

// ============================================================
// 深度思考区块
// ============================================================
const ThinkingBlock = memo(function ThinkingBlock({
  text,
  expanded,
  onToggle,
  isStreaming,
}: {
  text: string
  expanded: boolean
  onToggle: () => void
  isStreaming: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  // 流式更新时，只有当用户在底部才自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !expanded || !isStreaming) return
    // 如果用户手动滚上去了，不去抢滚动
    if (userScrolledRef.current) return

    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    if (isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [text, expanded, isStreaming])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    userScrolledRef.current = !isAtBottom
  }

  if (!text.trim()) return null

  return (
    <div style={{ margin: '6px 0' }}>
      {/* 标题栏 */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          cursor: 'pointer', userSelect: 'none',
          padding: '2px 0',
          fontSize: '12px',
          color: THINK_COLOR,
        }}
      >
        <span style={{ fontWeight: 500 }}>深度思考</span>
        {expanded
          ? <ChevronDown size={12} style={{ opacity: 0.7 }} />
          : <ChevronRight size={12} style={{ opacity: 0.7 }} />
        }
      </div>

      {/* 内容 */}
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            fontSize: '13px', color: 'var(--color-text-secondary)',
            lineHeight: '1.7', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            padding: '8px 10px',
            maxHeight: '200px',
            overflowY: 'auto',
            overflowAnchor: 'none',
            borderLeft: `2px solid ${THINK_COLOR}40`,
            borderRadius: '4px',
            background: `${THINK_COLOR}06`,
          } as React.CSSProperties}>
          {text.trim()}
        </div>
      )}
    </div>
  )
})

// ============================================================
// 单条工具调用行
// ============================================================
const ToolLine = memo(function ToolLine({ entry }: { entry: ToolCallEntry }) {
  const isDone = entry.state === 'output-available'
  const isError = entry.state === 'output-error'
  const isRunning = entry.state === 'input-streaming' || entry.state === 'input-available'
  const desc = describeAction(entry)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '1.5px 0 1.5px 16px',
      fontSize: '12px', lineHeight: '1.6',
    }}>
      <span style={{ flexShrink: 0, width: '14px', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? (
          <Loader2 size={11} className="tool-spinner" style={{ color: RUN_COLOR }} />
        ) : isDone ? (
          <Check size={11} style={{ color: DONE_COLOR }} />
        ) : isError ? (
          <AlertCircle size={11} style={{ color: ERR_COLOR }} />
        ) : null}
      </span>
      <span style={{
        color: isRunning ? 'var(--color-text-secondary)' : isError ? ERR_COLOR : FADED,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {desc}
      </span>
    </div>
  )
})

// ============================================================
// 主组件
// ============================================================
export const AgentStepView = memo(function AgentStepView({
  groups,
  isStreaming,
}: {
  groups: StepGroup[]
  isStreaming: boolean
}) {
  if (groups.length === 0) return null

  const [expanded, setExpanded] = useState(() => isStreaming)
  const [thinkingExpanded, setThinkingExpanded] = useState<Record<number, boolean>>({})

  // 进行时自动展开，完成后自动折叠
  const prevStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // 开始执行 → 展开
      setExpanded(true)
    } else if (!isStreaming && prevStreamingRef.current) {
      // 执行完成 → 折叠
      setExpanded(false)
      setThinkingExpanded({})
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming])

  // 统计
  const totalCalls = groups.reduce((sum, g) => sum + g.toolCalls.length, 0)
  const totalThinking = groups.filter(g => g.thinking?.trim()).length
  const allComplete = groups.every(g => g.isComplete)

  // 切换所有思考区块
  const toggleThinking = (idx: number) => {
    setThinkingExpanded(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  // 摘要行：「> 8 个工具调用, 12 条过程消息」
  const summaryText = `${totalCalls} 个工具调用, ${totalThinking} 条过程消息`

  return (
    <div style={{ overflowAnchor: 'none' } as React.CSSProperties}>
      {/* 折叠摘要行 */}
      {!expanded && (
        <div
          onClick={() => setExpanded(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            cursor: 'pointer', userSelect: 'none',
            padding: '4px 0',
            fontSize: '13px',
            color: FADED,
          }}
        >
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
          <span>{summaryText}</span>
          {allComplete && <span style={{ marginLeft: '4px' }}>完成</span>}
        </div>
      )}

      {/* 展开后的完整内容 */}
      {expanded && (
        <div>
          {/* 摘要行（点击可折叠） */}
          <div
            onClick={() => setExpanded(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              cursor: 'pointer', userSelect: 'none',
              padding: '4px 0',
              fontSize: '13px',
              color: FADED,
              marginBottom: '4px',
            }}
          >
            <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
            <span>{summaryText}</span>
          </div>

          {/* 各步骤内容平铺 */}
          {groups.map((group, idx) => {
            const isThinkExpanded = thinkingExpanded[idx] ?? isStreaming
            const hasThinking = !!(group.thinking && group.thinking.trim())

            return (
              <div key={group.stepIndex}>
                {/* 深度思考 */}
                {hasThinking && (
                  <ThinkingBlock
                    text={group.thinking!}
                    expanded={isThinkExpanded}
                    onToggle={() => toggleThinking(idx)}
                    isStreaming={isStreaming}
                  />
                )}

                {/* 工具调用列表 */}
                {group.toolCalls.map((t, i) => (
                  <ToolLine key={t.toolCallId ?? `${group.stepIndex}-${i}`} entry={t} />
                ))}

                {/* 步骤间分隔（除了最后） */}
                {idx < groups.length - 1 && (
                  <div style={{ height: '8px' }} />
                )}
              </div>
            )
          })}

          {/* 进行中提示 */}
          {isStreaming && groups.some(g => g.isActive) && (
            <div style={{
              fontSize: '10px', color: RUN_COLOR,
              display: 'flex', alignItems: 'center', gap: '4px',
              marginTop: '6px',
            }}>
              <Loader2 size={10} className="tool-spinner" />
              Agent 正在执行…
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default AgentStepView
