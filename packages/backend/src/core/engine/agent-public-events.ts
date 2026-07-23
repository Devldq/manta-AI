import type {
  AgentPublicEvent,
  AgentPublicEventType,
  AgentRunPhase,
  AgentRunSnapshot,
  AgentRunUsage,
  JsonValue,
} from '@manta/contracts'
import type { AgentRuntimeEvent, AgentRuntimeExtension } from './runtime-hooks'

const SECRET_KEY = /(authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)/i
const MAX_PUBLIC_STRING = 2_000

function appendProgressText(current: string | undefined, next: string): string {
  const messages = current?.split('\n').map(item => item.trim()).filter(Boolean) ?? []
  if (!messages.includes(next.trim())) messages.push(next.trim())
  return messages.join('\n')
}

function sanitize(value: unknown, depth = 0): JsonValue {
  if (depth > 5) return '[已省略]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length > MAX_PUBLIC_STRING ? `${value.slice(0, MAX_PUBLIC_STRING)}…（已截断）` : value
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      result[key] = SECRET_KEY.test(key) ? '[已脱敏]' : sanitize(item, depth + 1)
    }
    return result
  }
  return String(value)
}

export class AgentPublicEventProjector {
  private phase: AgentRunPhase = 'queued'
  private publicSeq = 0
  private summaryStarted = false
  private readonly snapshot: AgentRunSnapshot

  readonly extension: AgentRuntimeExtension = {
    name: 'agent-public-event-projector',
    onEvent: event => this.onRuntimeEvent(event),
  }

  constructor(
    private readonly context: { runId: string; conversationId: string; messageId: string },
    private readonly sink: (event: AgentPublicEvent) => Promise<number | void> | number | void,
    initialSnapshot?: AgentRunSnapshot,
  ) {
    const canResume = initialSnapshot
      && initialSnapshot.runId === context.runId
      && initialSnapshot.conversationId === context.conversationId
      && initialSnapshot.messageId === context.messageId
    if (canResume) {
      this.snapshot = structuredClone(initialSnapshot)
      this.phase = initialSnapshot.phase
      this.publicSeq = initialSnapshot.lastSeq
    } else {
      this.snapshot = {
        schemaVersion: 1,
        ...context,
        status: 'queued',
        phase: 'queued',
        lastSeq: 0,
        steps: [],
      }
    }
  }

  getSnapshot(): AgentRunSnapshot {
    return structuredClone(this.snapshot)
  }

  async finalize(
    summaryMarkdown: string,
    usage: AgentRunUsage,
    persist?: (snapshot: AgentRunSnapshot) => Promise<void> | void,
  ): Promise<void> {
    if (this.snapshot.status === 'completed') return
    await this.startSummary()
    this.snapshot.summaryMarkdown = summaryMarkdown
    this.snapshot.usage = usage
    this.snapshot.status = 'completed'
    this.snapshot.completedAt = new Date().toISOString()
    this.snapshot.durationMs = usage.durationMs
    const completedSnapshot = this.getSnapshot()
    completedSnapshot.phase = 'completed'
    await persist?.(completedSnapshot)
    await this.emit('summary.completed', { summaryMarkdown })
    await this.emit('usage.finalized', usage as unknown as JsonValue)
    await this.changePhase('completed')
    await this.emit('run.completed', {
      durationMs: usage.durationMs,
      stepCount: usage.stepCount,
      toolCallCount: usage.toolCallCount,
    })
  }

  private async onRuntimeEvent(event: AgentRuntimeEvent): Promise<void> {
    switch (event.type) {
      case 'loop.started':
        this.snapshot.status = 'running'
        this.snapshot.startedAt = event.timestamp
        await this.changePhase('executing', event.timestamp)
        await this.emit('run.started', {
          model: event.data.model,
          provider: event.data.provider,
          resumed: event.data.resumed,
        }, event.timestamp)
        return
      case 'step.started': {
        if (event.data.forcingFinalResponse) {
          await this.startSummary(event.timestamp)
          return
        }
        if (!this.snapshot.steps.some(step => step.stepIndex === event.data.stepIndex)) {
          this.snapshot.steps.push({
            stepIndex: event.data.stepIndex,
            status: 'running',
            startedAt: event.timestamp,
            tools: [],
          })
        }
        await this.emit('step.started', { stepIndex: event.data.stepIndex }, event.timestamp, event.data.stepIndex)
        return
      }
      case 'step.progress': {
        const step = this.snapshot.steps.find(item => item.stepIndex === event.data.stepIndex)
        const progressText = appendProgressText(step?.progressText, event.data.text)
        if (step?.progressText === progressText) return
        if (step) step.progressText = progressText
        await this.emit('progress.committed', { text: event.data.text }, event.timestamp, event.data.stepIndex)
        return
      }
      case 'step.completed': {
        const step = this.snapshot.steps.find(item => item.stepIndex === event.data.stepIndex)
        if (step) {
          step.status = event.data.toolErrorCount > 0 ? 'failed' : 'completed'
          step.completedAt = event.timestamp
          step.durationMs = event.data.durationMs
        }
        return
      }
      case 'tool.started': {
        const step = [...this.snapshot.steps].reverse().find(item => item.status === 'running')
        const toolCallId = event.data.toolCallId ?? `${event.data.toolName}:${event.sequence}`
        if (step && event.data.publicReason) {
          const progressText = appendProgressText(step.progressText, event.data.publicReason)
          if (step.progressText !== progressText) {
            step.progressText = progressText
            await this.emit(
              'progress.committed',
              { text: event.data.publicReason },
              event.timestamp,
              step.stepIndex,
            )
          }
        }
        if (step) {
          step.tools.push({
            toolCallId,
            toolName: event.data.toolName,
            status: 'running',
            input: sanitize(event.data.input),
          })
        }
        await this.emit('tool.started', {
          toolName: event.data.toolName,
          input: sanitize(event.data.input),
        }, event.timestamp, step?.stepIndex, toolCallId)
        return
      }
      case 'tool.completed': {
        const tool = this.findTool(event.data.toolCallId, event.data.toolName)
        if (tool) {
          tool.status = 'completed'
          tool.durationMs = event.data.durationMs
          tool.outputChars = event.data.outputChars
        }
        await this.emit('tool.completed', sanitize(event.data), event.timestamp, undefined, event.data.toolCallId)
        return
      }
      case 'tool.failed': {
        const tool = this.findTool(event.data.toolCallId, event.data.toolName)
        if (tool) {
          tool.status = 'failed'
          tool.durationMs = event.data.durationMs
          tool.error = String(sanitize(event.data.error))
        }
        await this.emit('tool.failed', {
          toolName: event.data.toolName,
          durationMs: event.data.durationMs,
          error: sanitize(event.data.error),
        }, event.timestamp, undefined, event.data.toolCallId)
        return
      }
      case 'approval.requested':
        this.snapshot.status = 'waiting_for_input'
        await this.changePhase('waiting_approval', event.timestamp)
        await this.emit('approval.requested', sanitize(event.data), event.timestamp)
        return
      case 'approval.resolved':
        this.snapshot.status = 'running'
        await this.emit('approval.resolved', sanitize(event.data), event.timestamp)
        await this.changePhase('executing', event.timestamp)
        return
      case 'loop.suspended':
        this.snapshot.status = 'waiting_for_input'
        await this.changePhase('waiting_approval', event.timestamp)
        return
      case 'loop.aborted':
        if (this.snapshot.status === 'cancelled') return
        this.snapshot.status = 'cancelled'
        this.snapshot.completedAt = event.timestamp
        this.snapshot.durationMs = this.elapsedDuration(event.timestamp)
        await this.changePhase('cancelled', event.timestamp)
        await this.emit('run.cancelled', { reason: event.data.reason }, event.timestamp)
        return
      case 'loop.failed':
        this.snapshot.status = 'failed'
        this.snapshot.completedAt = event.timestamp
        this.snapshot.durationMs = event.data.durationMs
        this.snapshot.summaryMarkdown = event.data.error
        await this.changePhase('failed', event.timestamp)
        await this.emit('run.failed', { error: sanitize(event.data.error) }, event.timestamp)
        return
      default:
        return
    }
  }

  private findTool(toolCallId: string | undefined, toolName: string) {
    for (const step of [...this.snapshot.steps].reverse()) {
      const tool = [...step.tools].reverse().find(item =>
        toolCallId ? item.toolCallId === toolCallId : item.toolName === toolName && item.status === 'running'
      )
      if (tool) return tool
    }
    return undefined
  }

  private async changePhase(phase: AgentRunPhase, timestamp = new Date().toISOString()): Promise<void> {
    if (this.phase === phase) return
    const previous = this.phase
    this.phase = phase
    this.snapshot.phase = phase
    await this.emit('phase.changed', { previous, phase }, timestamp)
  }

  private async startSummary(timestamp = new Date().toISOString()): Promise<void> {
    await this.changePhase('summarizing', timestamp)
    if (this.summaryStarted) return
    this.summaryStarted = true
    await this.emit('summary.started', {}, timestamp)
  }

  private async emit(
    type: AgentPublicEventType,
    data: JsonValue,
    timestamp = new Date().toISOString(),
    stepIndex?: number,
    toolCallId?: string,
  ): Promise<void> {
    const seq = ++this.publicSeq
    const canonicalSeq = await this.sink({
      schemaVersion: 1,
      ...this.context,
      seq,
      timestamp,
      phase: this.phase,
      type,
      ...(stepIndex === undefined ? {} : { stepIndex }),
      ...(toolCallId ? { toolCallId } : {}),
      data,
    })
    this.snapshot.lastSeq = typeof canonicalSeq === 'number' ? canonicalSeq : seq
  }

  private elapsedDuration(completedAt: string): number | undefined {
    if (!this.snapshot.startedAt) return undefined
    const duration = Date.parse(completedAt) - Date.parse(this.snapshot.startedAt)
    return Number.isFinite(duration) ? Math.max(0, duration) : undefined
  }
}
