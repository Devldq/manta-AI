import { AgentRunPayloadSchema, type JsonValue } from '@manta/contracts'
import type { JobExecutorRegistration } from '@manta/task-runtime'
import { getConversation } from '../storage/conversation/store.js'
import { getWorkspaceConversation } from '../storage/workspace/store.js'
import { startAgentLoop } from './stream-handler.js'
import type { UIMessage } from './message-parser.js'
import type { ProcessRegistry } from './runner/process-registry.js'

export function createAgentRunExecutor(options: { processRegistry?: ProcessRegistry } = {}): JobExecutorRegistration {
  return {
    kind: 'agent.run',
    // Tool calls can have external side effects. A process interruption must be
    // resolved explicitly instead of replaying the last model/tool step.
    interruption: 'manual-recovery',
    async execute(context) {
      const payload = AgentRunPayloadSchema.parse(context.job.payload)
      const recovery = context.readCheckpoint<{ decision: 'retry-step' | 'skip-step' | 'fail' }>('__recovery__')
      if (recovery?.decision === 'skip-step') {
        return { conversationId: payload.conversationId, skippedInterruptedStep: true }
      }
      const committed = context.readCheckpoint<{ messageId: string; toolCallCount?: number }>('assistant_message_committed')
      if (committed) {
        const conversation = payload.workspaceId
          ? getWorkspaceConversation(payload.workspaceId, payload.conversationId)
          : getConversation(payload.conversationId)
        const message = conversation?.messages.find((item) => item.id === committed.messageId)
        if (message) return { conversationId: payload.conversationId, messageId: message.id, content: message.content, toolCallCount: message.toolCalls?.length ?? committed.toolCallCount ?? 0 } as JsonValue
      }
      context.checkpoint('agent_loop_started', { attempt: context.attempt, messageId: payload.messageId })
      const started = await startAgentLoop({
        messages: payload.messages as unknown as UIMessage[],
        agentName: payload.agentName,
        conversationId: payload.conversationId,
        workspaceId: payload.workspaceId,
        messageId: payload.messageId,
        historyMode: payload.historyMode,
        jobContext: context,
        processRegistry: options.processRegistry,
      })
      await started.completion
      context.signal.throwIfAborted()
      const conversation = payload.workspaceId
        ? getWorkspaceConversation(payload.workspaceId, payload.conversationId)
        : getConversation(payload.conversationId)
      const message = conversation?.messages.find((item) => item.id === started.assistantMessageId)
      if (!message) throw new Error('Agent loop completed without committing its assistant message')
      return { conversationId: payload.conversationId, messageId: message.id, content: message.content, toolCallCount: message.toolCalls?.length ?? 0 } as JsonValue
    },
  }
}
