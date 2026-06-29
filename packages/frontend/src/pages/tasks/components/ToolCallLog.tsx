import { memo } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { AgentStepView } from './AgentStepView'
import { extractStepGroups } from '../utils/formatters'

interface ToolCallLogProps {
  parts: any[]
  isStreaming: boolean
}

export const ToolCallLog = memo(function ToolCallLog({ parts, isStreaming }: ToolCallLogProps) {
  const groups = extractStepGroups(parts)
  if (groups.length === 0) return null

  const hasActive   = groups.some((g) => g.isActive)
  const totalCalls  = groups.reduce((sum, g) => sum + g.toolCalls.length, 0)
  const errorCount  = groups.reduce((sum, g) => sum + g.toolCalls.filter((t) => t.state === 'output-error').length, 0)

  return (
    <div style={{ marginBottom: '10px' }}>
      <AgentStepView groups={groups} isStreaming={isStreaming} />

      {/* 全部完成 */}
      {!hasActive && totalCalls > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 0',
          fontSize: '10px',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          <Check size={11} style={{ color: 'var(--color-status-done)' }} />
          {totalCalls} 个操作
          {errorCount > 0 && <span style={{ color: 'var(--color-status-failed)' }}> · {errorCount} 错误</span>}
        </div>
      )}
    </div>
  )
})
