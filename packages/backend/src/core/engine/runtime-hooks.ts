import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Agent Runtime lifecycle hooks.
 *
 * Extensions are observers: they receive ordered, strongly typed events but
 * cannot mutate the loop. An extension failure is isolated so logging,
 * tracing, or audit integrations never take down an agent run.
 */

export interface AgentRuntimeContext {
  runId: string
  conversationId?: string
  messageId?: string
  taskId?: string
  workspaceId?: string
  jobId?: string
  agentName?: string
}

export interface AgentRuntimeEventMap {
  'loop.started': {
    resumed: boolean
    messageCount: number
    model: string
    provider: string
    maxSteps: number
    maxOutputTokens: number
  }
  'loop.completed': {
    durationMs: number
    totalSteps: number
    totalToolCalls: number
    totalToolErrors: number
    totalInputTokens: number
    totalOutputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
    stopReason: string
  }
  'loop.failed': { error: string; durationMs: number; stepIndex: number }
  'loop.aborted': { reason: 'abort-signal'; stepIndex: number }
  'loop.suspended': { reason: 'waiting-for-input'; stepIndex: number }
  'step.started': {
    stepIndex: number
    messageCount: number
    toolCount: number
    forcingFinalResponse: boolean
  }
  'step.progress': { stepIndex: number; text: string }
  'step.completed': {
    stepIndex: number
    durationMs: number
    textLength: number
    toolNames: string[]
    toolErrorCount: number
    finishReason: string
    usage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
    }
  }
  'step.committed': { stepIndex: number; nextStepIndex: number; messageCount: number }
  'tool.started': {
    toolName: string
    toolCallId?: string
    input: unknown
    publicReason?: string
    source: 'builtin' | 'mcp'
    concurrency: 'shared' | 'exclusive'
  }
  'tool.completed': {
    toolName: string
    toolCallId?: string
    durationMs: number
    outputChars: number
    truncated: boolean
  }
  'tool.failed': {
    toolName: string
    toolCallId?: string
    durationMs: number
    error: string
  }
  'approval.requested': { request: { type: 'read' | 'write' | 'shell'; path?: string; command?: string } }
  'approval.resolved': {
    request: { type: 'read' | 'write' | 'shell'; path?: string; command?: string }
    approved: boolean
  }
  'approval.failed': {
    request: { type: 'read' | 'write' | 'shell'; path?: string; command?: string }
    error: string
  }
  'context.optimized': {
    stepIndex: number
    strategy: 'microcompact' | 'truncate' | 'ttl-prune' | 'llm-compaction'
    affectedCount: number
    messageCountBefore: number
    messageCountAfter: number
  }
}

export type AgentRuntimeEventType = keyof AgentRuntimeEventMap

export type AgentRuntimeEvent = {
  [Type in AgentRuntimeEventType]: {
    type: Type
    sequence: number
    timestamp: string
    context: AgentRuntimeContext
    data: AgentRuntimeEventMap[Type]
  }
}[AgentRuntimeEventType]

export interface AgentRuntimeExtension {
  /** Stable name used for diagnostics and de-duplication. */
  name: string
  onEvent(event: AgentRuntimeEvent): Promise<void> | void
}

export interface AgentRuntimeHookError {
  extensionName: string
  eventType: AgentRuntimeEventType
  error: unknown
}

const globalExtensions = new Map<string, AgentRuntimeExtension>()

/** Register an extension for future runs. Existing runs keep their snapshot. */
export function registerAgentRuntimeExtension(extension: AgentRuntimeExtension): () => void {
  globalExtensions.set(extension.name, extension)
  return () => {
    if (globalExtensions.get(extension.name) === extension) {
      globalExtensions.delete(extension.name)
    }
  }
}

export function getAgentRuntimeExtensions(): AgentRuntimeExtension[] {
  return [...globalExtensions.values()]
}

export class AgentRuntimeHooks {
  private sequence = 0
  private readonly extensions: AgentRuntimeExtension[]

  constructor(
    readonly context: AgentRuntimeContext,
    extensions: AgentRuntimeExtension[] = [],
    private readonly onExtensionError?: (failure: AgentRuntimeHookError) => void,
  ) {
    const merged = new Map<string, AgentRuntimeExtension>()
    for (const extension of [...getAgentRuntimeExtensions(), ...extensions]) {
      merged.set(extension.name, extension)
    }
    this.extensions = [...merged.values()]
  }

  async emit<Type extends AgentRuntimeEventType>(
    type: Type,
    data: AgentRuntimeEventMap[Type],
  ): Promise<void> {
    const event = {
      type,
      sequence: this.sequence++,
      timestamp: new Date().toISOString(),
      context: this.context,
      data,
    } as AgentRuntimeEvent

    for (const extension of this.extensions) {
      try {
        await extension.onEvent(event)
      } catch (error) {
        this.onExtensionError?.({ extensionName: extension.name, eventType: type, error })
      }
    }
  }
}

const runtimeHookStorage = new AsyncLocalStorage<AgentRuntimeHooks>()

/** Access the current run's hooks from deeply nested tool/security code. */
export function getAgentRuntimeHooks(): AgentRuntimeHooks | undefined {
  return runtimeHookStorage.getStore()
}

/** Keep one ordered hook bus available across the complete async run. */
export function runWithAgentRuntimeHooks<T>(hooks: AgentRuntimeHooks, fn: () => T): T {
  return runtimeHookStorage.run(hooks, fn)
}
