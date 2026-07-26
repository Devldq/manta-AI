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

const READ_ONLY_TOOLS = new Set([
  'find',
  'glob',
  'grep',
  'listDirectory',
  'lsDir',
  'read',
  'readFile',
  'search',
])

function mergePurposeText(...values: Array<string | undefined>): string {
  const lines = values
    .flatMap(value => value?.split('\n') ?? [])
    .map(value => value.trim())
    .filter(Boolean)
  return [...new Set(lines)].join('\n')
}

function isReadOnlyGroup(group: StepGroup): boolean {
  return group.toolCalls.length > 0
    && group.toolCalls.every(tool => READ_ONLY_TOOLS.has(tool.toolName))
}

/** Collapse adjacent read-only steps into one visible investigation batch. */
export function compactReadOnlyStepGroups(groups: StepGroup[]): StepGroup[] {
  const compacted: StepGroup[] = []

  for (const group of groups) {
    const previous = compacted[compacted.length - 1]
    if (previous && isReadOnlyGroup(previous) && isReadOnlyGroup(group)) {
      const thinking = mergePurposeText(previous.thinking, group.thinking)
      previous.purposeText = mergePurposeText(previous.purposeText, group.purposeText)
      previous.thinking = thinking || undefined
      previous.toolCalls = [...previous.toolCalls, ...group.toolCalls]
      previous.isComplete = previous.isComplete && group.isComplete
      previous.isActive = previous.isActive || group.isActive
      continue
    }
    compacted.push({
      ...group,
      toolCalls: [...group.toolCalls],
    })
  }

  return compacted
}

export function mergeAgentRunProgress(
  groups: StepGroup[],
  agentRun?: AgentRunSnapshot,
): StepGroup[] {
  if (!agentRun) return groups
  return groups.map((group) => {
    const progressText = agentRun.steps.find(step => step.stepIndex === group.stepIndex)?.progressText
    if (!progressText) return group
    return {
      ...group,
      purposeText: progressText,
      thinking: progressText,
    }
  })
}

export const ToolCallLog = memo(function ToolCallLog({ parts, isStreaming, agentRun, onOpenFile }: ToolCallLogProps) {
  const streamedGroups = extractStepGroups(parts)
  const hydratedGroups = streamedGroups.length > 0 ? mergeAgentRunProgress(streamedGroups, agentRun) : (agentRun?.steps.map(step => ({
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
  const groups = compactReadOnlyStepGroups(hydratedGroups)
  if (groups.length === 0 && !agentRun) return null

  return (
    <div style={{ marginBottom: '10px' }}>
      <AgentStepView groups={groups} isStreaming={isStreaming} agentRun={agentRun} onOpenFile={onOpenFile} />
    </div>
  )
})
