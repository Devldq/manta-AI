'use client'

import { useState, memo } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ToolCallEntry } from '../utils/types'
import { ToolCallItem } from './ToolCallItem'

const TOOL_LOG_MAX = 5 // 超过此数量折叠

export const ToolCallLog = memo(function ToolCallLog({
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          <ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />
          <span style={{ fontFamily: 'var(--font-mono)' }}>收起</span>
        </button>
      )}

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
