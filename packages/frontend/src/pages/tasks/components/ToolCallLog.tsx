import { useState, memo } from 'react'
import { Check, AlertCircle, Loader2 } from 'lucide-react'
import type { StepGroup } from '../utils/types'
import { AgentStepView } from './AgentStepView'
import { extractStepGroups } from '../utils/formatters'

interface ToolCallLogProps {
  /** 消息的 parts，用于提取步骤分组 */
  parts: any[]
  isStreaming: boolean
}

export const ToolCallLog = memo(function ToolCallLog({
  parts,
  isStreaming,
}: ToolCallLogProps) {
  const groups = extractStepGroups(parts)

  if (groups.length === 0) return null

  const hasActive = groups.some((g) => g.isActive)
  const totalCalls = groups.reduce((sum, g) => sum + g.toolCalls.length, 0)
  const errorCount = groups.reduce(
    (sum, g) => sum + g.toolCalls.filter((t) => t.state === 'output-error').length,
    0
  )

  return (
    <div>
      {/* 步骤视图 */}
      <AgentStepView groups={groups} isStreaming={isStreaming} />

      {/* 完成状态摘要 */}
      {!hasActive && totalCalls > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          <Check size={12} style={{ color: 'var(--color-status-done)', flexShrink: 0 }} />
          <span>
            完成 — {groups.length} 步 · {totalCalls} 个工具调用
            {errorCount > 0 && ` · ${errorCount} 个错误`}
          </span>
        </div>
      )}

      {/* 流式状态：显示进行中 */}
      {isStreaming && hasActive && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-mono)',
        }}>
          <Loader2 size={12} className="tool-spinner" />
          <span>Agent 工作中…</span>
        </div>
      )}
    </div>
  )
})
