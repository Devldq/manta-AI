import { memo } from 'react'
import type { AgentRunSnapshot } from '@manta/contracts'
import { AgentStepView } from './AgentStepView'
import { extractStepGroups } from '../utils/formatters'
import type { StepGroup } from '../utils/types'

interface ToolCallLogProps {
  parts: any[]
  isStreaming: boolean
  agentRun?: AgentRunSnapshot
  onOpenFile?: (path: string) => void
}

export function mergeAgentRunProgress(
  groups: StepGroup[],
  agentRun?: AgentRunSnapshot,
): StepGroup[] {
  if (!agentRun) return groups
  return groups.map((group) => {
    const progressText = agentRun.steps.find(step => step.stepIndex === group.stepIndex)?.progressText
    if (!progressText || group.thinking?.trim()) return group
    return {
      ...group,
      purposeText: group.purposeText || progressText,
      thinking: progressText,
    }
  })
}

export const ToolCallLog = memo(function ToolCallLog({ parts, isStreaming, agentRun, onOpenFile }: ToolCallLogProps) {
  const streamedGroups = extractStepGroups(parts)
  const groups = streamedGroups.length > 0 ? mergeAgentRunProgress(streamedGroups, agentRun) : (agentRun?.steps.map(step => ({
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
