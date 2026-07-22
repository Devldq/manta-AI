import { z } from 'zod'

const AgentJsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(AgentJsonValueSchema),
  z.record(z.string(), AgentJsonValueSchema),
]))

export const AgentRunPhaseSchema = z.enum([
  'queued',
  'executing',
  'waiting_approval',
  'summarizing',
  'awaiting_user',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
])
export type AgentRunPhase = z.infer<typeof AgentRunPhaseSchema>

export const AgentRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
])
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const AgentPublicEventTypeSchema = z.enum([
  'run.started',
  'phase.changed',
  'step.started',
  'progress.committed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'approval.requested',
  'approval.resolved',
  'summary.started',
  'summary.completed',
  'interaction.requested',
  'usage.finalized',
  'run.cancellation_requested',
  'run.cancelled',
  'run.completed',
  'run.failed',
])
export type AgentPublicEventType = z.infer<typeof AgentPublicEventTypeSchema>

export const AgentRunUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  noCacheTokens: z.number().int().nonnegative().optional(),
  stepCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  toolErrorCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  completeness: z.enum(['complete', 'partial']),
})
export type AgentRunUsage = z.infer<typeof AgentRunUsageSchema>

export const AgentRunToolSnapshotSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  input: AgentJsonValueSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  outputChars: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
})
export type AgentRunToolSnapshot = z.infer<typeof AgentRunToolSnapshotSchema>

export const AgentRunStepSnapshotSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  status: z.enum(['running', 'completed', 'failed']),
  progressText: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  tools: z.array(AgentRunToolSnapshotSchema),
})
export type AgentRunStepSnapshot = z.infer<typeof AgentRunStepSnapshotSchema>

export const AgentRunSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  status: AgentRunStatusSchema,
  phase: AgentRunPhaseSchema,
  lastSeq: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  steps: z.array(AgentRunStepSnapshotSchema),
  summaryMarkdown: z.string().optional(),
  usage: AgentRunUsageSchema.optional(),
})
export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>

export const AgentPublicEventSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  phase: AgentRunPhaseSchema,
  type: AgentPublicEventTypeSchema,
  stepIndex: z.number().int().nonnegative().optional(),
  toolCallId: z.string().optional(),
  data: AgentJsonValueSchema.default({}),
})
export type AgentPublicEvent = z.infer<typeof AgentPublicEventSchema>
