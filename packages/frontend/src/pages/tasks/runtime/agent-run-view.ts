import type { UIMessage } from 'ai'
import type {
  AgentPublicEvent,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunToolSnapshot,
} from '@manta/contracts'

export const TERMINAL_AGENT_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'cancelled',
  'failed',
])

function cloneSnapshot(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return structuredClone(snapshot)
}

function createSnapshot(event: AgentPublicEvent): AgentRunSnapshot {
  return {
    schemaVersion: 1,
    runId: event.runId,
    conversationId: event.conversationId,
    messageId: event.messageId,
    status: 'queued',
    phase: 'queued',
    lastSeq: 0,
    steps: [],
  }
}

function findTool(snapshot: AgentRunSnapshot, event: AgentPublicEvent): AgentRunToolSnapshot | undefined {
  for (const step of [...snapshot.steps].reverse()) {
    const tool = [...step.tools].reverse().find(item => item.toolCallId === event.toolCallId)
    if (tool) return tool
  }
  return undefined
}

export function applyAgentPublicEvent(
  current: AgentRunSnapshot | undefined,
  event: AgentPublicEvent,
): AgentRunSnapshot {
  const snapshot = current?.runId === event.runId ? cloneSnapshot(current) : createSnapshot(event)
  if (event.seq <= snapshot.lastSeq) return snapshot

  snapshot.lastSeq = event.seq
  snapshot.phase = event.phase
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {}

  switch (event.type) {
    case 'run.started':
      snapshot.status = 'running'
      snapshot.startedAt = event.timestamp
      break
    case 'phase.changed':
      if (event.phase === 'cancelling') snapshot.status = 'cancelling'
      break
    case 'step.started':
      if (event.stepIndex !== undefined && !snapshot.steps.some(step => step.stepIndex === event.stepIndex)) {
        snapshot.steps.push({
          stepIndex: event.stepIndex,
          status: 'running',
          startedAt: event.timestamp,
          tools: [],
        })
      }
      break
    case 'progress.committed': {
      const step = snapshot.steps.find(item => item.stepIndex === event.stepIndex)
      if (step && typeof data.text === 'string') step.progressText = data.text
      break
    }
    case 'tool.started': {
      const step = snapshot.steps.find(item => item.stepIndex === event.stepIndex)
        ?? [...snapshot.steps].reverse().find(item => item.status === 'running')
      if (step && event.toolCallId && typeof data.toolName === 'string') {
        step.tools.push({
          toolCallId: event.toolCallId,
          toolName: data.toolName,
          status: 'running',
          input: data.input,
        })
      }
      break
    }
    case 'tool.completed': {
      const tool = findTool(snapshot, event)
      if (tool) {
        tool.status = 'completed'
        if (typeof data.durationMs === 'number') tool.durationMs = data.durationMs
        if (typeof data.outputChars === 'number') tool.outputChars = data.outputChars
      }
      break
    }
    case 'tool.failed': {
      const tool = findTool(snapshot, event)
      if (tool) {
        tool.status = 'failed'
        if (typeof data.durationMs === 'number') tool.durationMs = data.durationMs
        if (typeof data.error === 'string') tool.error = data.error
      }
      break
    }
    case 'approval.requested':
    case 'interaction.requested':
      snapshot.status = 'waiting_for_input'
      break
    case 'approval.resolved':
      snapshot.status = 'running'
      break
    case 'run.cancellation_requested':
      snapshot.status = 'cancelling'
      break
    case 'summary.completed':
      if (typeof data.summaryMarkdown === 'string') snapshot.summaryMarkdown = data.summaryMarkdown
      break
    case 'usage.finalized':
      snapshot.usage = data as AgentRunSnapshot['usage']
      if (snapshot.usage?.durationMs !== undefined) snapshot.durationMs = snapshot.usage.durationMs
      break
    case 'run.completed':
      snapshot.status = 'completed'
      snapshot.phase = 'completed'
      snapshot.completedAt = event.timestamp
      break
    case 'run.cancelled':
      snapshot.status = 'cancelled'
      snapshot.phase = 'cancelled'
      snapshot.completedAt = event.timestamp
      break
    case 'run.failed':
      snapshot.status = 'failed'
      snapshot.phase = 'failed'
      snapshot.completedAt = event.timestamp
      break
  }

  return snapshot
}

export function getAgentRunSnapshot(
  parts: UIMessage['parts'],
  metadata?: unknown,
): AgentRunSnapshot | undefined {
  const metaSnapshot = metadata && typeof metadata === 'object'
    ? (metadata as { agentRun?: AgentRunSnapshot | null }).agentRun ?? undefined
    : undefined
  let snapshot = metaSnapshot ? cloneSnapshot(metaSnapshot) : undefined
  const events: AgentPublicEvent[] = []

  for (const part of parts) {
    const candidate = part as unknown as { type?: string; data?: unknown }
    if (candidate.type === 'data-agent-run-snapshot' && candidate.data) {
      snapshot = cloneSnapshot(candidate.data as AgentRunSnapshot)
    } else if (candidate.type === 'data-agent-run' && candidate.data) {
      events.push(candidate.data as AgentPublicEvent)
    }
  }

  events.sort((left, right) => left.seq - right.seq)
  for (const event of events) snapshot = applyAgentPublicEvent(snapshot, event)
  return snapshot
}

export function isAgentRunTerminal(snapshot: AgentRunSnapshot | undefined): boolean {
  return snapshot ? TERMINAL_AGENT_RUN_STATUSES.has(snapshot.status) : false
}

export function formatAgentRunDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}
