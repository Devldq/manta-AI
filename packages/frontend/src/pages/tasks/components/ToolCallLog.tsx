import { memo } from 'react'
import type { AgentRunSnapshot } from '@manta/contracts'
import { AgentStepView } from './AgentStepView'
import { extractStepGroups } from '../utils/formatters'

interface ToolCallLogProps {
  parts: any[]
  isStreaming: boolean
  agentRun?: AgentRunSnapshot
  onOpenFile?: (path: string) => void
}

export const ToolCallLog = memo(function ToolCallLog({ parts, isStreaming, agentRun, onOpenFile }: ToolCallLogProps) {
  const streamedGroups = extractStepGroups(parts)
  const groups = streamedGroups.length > 0 ? streamedGroups : (agentRun?.steps.map(step => ({
    stepIndex: step.stepIndex,
    purposeText: step.progressText ?? '',
    thinking: step.progressText,
    toolCalls: step.tools.map(tool => ({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      state: tool.status === 'running' ? 'input-available' : tool.status === 'failed' ? 'output-error' : 'output-available',
      input: tool.input,
      output: tool.outputChars === undefined ? undefined : `${tool.outputChars} 字符输出`,
      errorText: tool.error,
    })),
    isComplete: step.status !== 'running',
    isActive: step.status === 'running',
  })) ?? [])
  if (groups.length === 0 && !agentRun) return null

  return (
    <div style={{ marginBottom: '10px' }}>
      <AgentStepView groups={groups} isStreaming={isStreaming} agentRun={agentRun} onOpenFile={onOpenFile} />
    </div>
  )
})
