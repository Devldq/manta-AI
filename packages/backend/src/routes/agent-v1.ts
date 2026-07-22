import { createHash, randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { TaskRuntime } from '@manta/task-runtime'
import { JsonValueSchema } from '@manta/contracts'
import { z } from 'zod'
import { getConversation } from '../core/storage/conversation/store.js'
import { getWorkspaceConversation } from '../core/storage/workspace/store.js'

export interface AgentV1RoutesOptions { runtime: TaskRuntime }

const RequestSchema = z.object({
  conversationId: z.string().min(1),
  prompt: z.string().trim().min(1).optional(),
  messages: z.array(JsonValueSchema).min(1).optional(),
  agentName: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
}).refine((value) => value.prompt || value.messages, { message: 'prompt or messages is required' })

export const agentV1Routes: FastifyPluginAsync<AgentV1RoutesOptions> = async (app, options) => {
  app.post('/v1/agent-runs', async (request, reply) => {
    try {
      const input = RequestSchema.parse(request.body)
      const conversation = input.workspaceId
        ? getWorkspaceConversation(input.workspaceId, input.conversationId)
        : getConversation(input.conversationId)
      if (!conversation) return reply.status(404).send({ error: { code: 'CONVERSATION_NOT_FOUND', message: `Conversation ${input.conversationId} was not found` } })
      const messages = input.messages ?? [
        ...conversation.messages.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: input.prompt! },
      ]
      const idempotencyKey = header(request.headers['idempotency-key'])
      const messageId = idempotencyKey
        ? `msg-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`
        : randomUUID()
      const job = options.runtime.createJob({
        kind: 'agent.run',
        payload: { conversationId: input.conversationId, messageId, agentName: input.agentName ?? conversation.agentName, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}), messages },
        metadata: { conversationId: input.conversationId, messageId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) },
        maxAttempts: 1,
        idempotencyKey,
      })
      return reply.status(202).header('location', `/v1/jobs/${job.id}`).send({ data: job })
    } catch (error) {
      return reply.status(error instanceof z.ZodError ? 400 : 500).send({ error: { code: error instanceof z.ZodError ? 'INVALID_REQUEST' : 'AGENT_RUN_FAILED', message: error instanceof Error ? error.message : String(error) } })
    }
  })
}

function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }
