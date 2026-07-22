import { memo } from 'react'
import { AgentStepView } from './AgentStepView'
import { extractStepGroups } from '../utils/formatters'

interface ToolCallLogProps {
  parts: any[]
  isStreaming: boolean
  onOpenFile?: (path: string) => void
}

export const ToolCallLog = memo(function ToolCallLog({ parts, isStreaming, onOpenFile }: ToolCallLogProps) {
  const groups = extractStepGroups(parts)
  if (groups.length === 0) return null

  return (
    <div style={{ marginBottom: '10px' }}>
      <AgentStepView groups={groups} isStreaming={isStreaming} onOpenFile={onOpenFile} />
    </div>
  )
})
