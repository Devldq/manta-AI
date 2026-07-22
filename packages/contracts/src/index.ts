import { z } from 'zod'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_input',
  'retry_scheduled',
  'recovery_required',
  'cancelling',
  'cancelled',
  'succeeded',
  'failed',
])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const JobKindSchema = z.enum([
  'rag.document.ingest',
  'rag.strategy.build',
  'rag.evaluation.run',
  'agent.run',
  'skill.run',
])
export type JobKind = z.infer<typeof JobKindSchema>

export const JobSchema = z.object({
  id: z.string().min(1),
  kind: JobKindSchema,
  status: JobStatusSchema,
  payload: JsonValueSchema,
  result: JsonValueSchema.optional(),
  error: z.object({ code: z.string(), message: z.string(), details: JsonValueSchema.optional() }).optional(),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  eventSeq: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1).optional(),
  checkpoint: z.string().optional(),
  recoveryReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  availableAt: z.string().datetime().optional(),
  cancelRequestedAt: z.string().datetime().optional(),
})
export type Job = z.infer<typeof JobSchema>

export const JobEventTypeSchema = z.enum([
  'job.created',
  'job.started',
  'job.progress',
  'job.checkpoint',
  'job.waiting_for_input',
  'job.input_received',
  'job.retry_scheduled',
  'job.recovery_required',
  'job.cancellation_requested',
  'job.cancelled',
  'job.succeeded',
  'job.failed',
  'artifact.created',
  'log',
])
export type JobEventType = z.infer<typeof JobEventTypeSchema>

export const JobEventSchema = z.object({
  jobId: z.string().min(1),
  seq: z.number().int().positive(),
  type: JobEventTypeSchema,
  timestamp: z.string().datetime(),
  data: JsonValueSchema.default({}),
})
export type JobEvent = z.infer<typeof JobEventSchema>

export const JobArtifactSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  kind: z.string().min(1),
  mediaType: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().min(1),
  metadata: z.record(z.string(), JsonValueSchema).default({}),
  createdAt: z.string().datetime(),
})
export type JobArtifact = z.infer<typeof JobArtifactSchema>

export const JobRecoveryDecisionSchema = z.object({
  decision: z.enum(['retry-step', 'skip-step', 'fail']),
  reason: z.string().trim().min(1).optional(),
})
export type JobRecoveryDecision = z.infer<typeof JobRecoveryDecisionSchema>

export const CreateJobSchema = z.object({
  kind: JobKindSchema,
  payload: JsonValueSchema,
  metadata: z.record(z.string(), JsonValueSchema).default({}),
  maxAttempts: z.number().int().min(1).max(20).default(3),
})
export type CreateJob = z.infer<typeof CreateJobSchema>

export const RagIngestPayloadSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  assetId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  documentId: z.string().min(1),
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().positive(),
  chunkStrategy: z.enum(['fixed', 'semantic', 'recursive']).optional(),
  chunkSize: z.number().int().positive().optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
  strategyVersionId: z.string().min(1).optional(),
})
export type RagIngestPayload = z.infer<typeof RagIngestPayloadSchema>

export const RagUploadPartSchema = z.object({
  number: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedAt: z.string().datetime(),
})
export type RagUploadPart = z.infer<typeof RagUploadPartSchema>

export const RagUploadSessionSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^upload\.[0-9a-f-]{36}$/),
  knowledgeBaseId: z.string().min(1),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  partSize: z.number().int().positive(),
  partCount: z.number().int().positive(),
  receivedParts: z.array(RagUploadPartSchema),
  status: z.enum(['uploading', 'completed']),
  assetId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})
export type RagUploadSession = z.infer<typeof RagUploadSessionSchema>

export const CreateRagUploadSessionSchema = z.object({
  name: z.string().trim().min(1),
  mediaType: z.string().trim().min(1).optional(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  partSize: z.number().int().min(256 * 1024).max(8 * 1024 * 1024).optional(),
})
export type CreateRagUploadSession = z.infer<typeof CreateRagUploadSessionSchema>

export const RagSourceAssetSchema = z.object({
  version: z.literal(1),
  assetId: z.string().regex(/^source\.[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().positive(),
  createdAt: z.string().datetime(),
}).refine((asset) => asset.assetId === `source.${asset.sha256}`, { path: ['assetId'], message: 'assetId must match sha256' })
export type RagSourceAsset = z.infer<typeof RagSourceAssetSchema>

export const AgentRunPayloadSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  agentName: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  messages: z.array(JsonValueSchema).min(1),
})
export type AgentRunPayload = z.infer<typeof AgentRunPayloadSchema>

export const SkillRunPayloadSchema = z.object({
  skillId: z.string().min(1),
  input: JsonValueSchema,
  grantedPermissions: z.array(z.string()).default([]),
})
export type SkillRunPayload = z.infer<typeof SkillRunPayloadSchema>

export const SkillPermissionsSchema = z.object({
  manta: z.array(z.string().min(1)).default([]),
  files: z.object({
    read: z.array(z.string().min(1)).default([]),
    write: z.array(z.string().min(1)).default([]),
  }).default({ read: [], write: [] }),
  network: z.array(z.string().min(1)).default([]),
  environment: z.array(z.string().min(1)).default([]),
  subprocess: z.boolean().default(false),
})
export type SkillPermissions = z.infer<typeof SkillPermissionsSchema>

export const SkillManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runtime: z.enum(['node', 'executable']),
  entry: z.string().min(1),
  executable: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(100).max(30 * 60_000).default(60_000),
  resources: z.array(z.string().min(1)).default([]),
  permissions: SkillPermissionsSchema.default({
    manta: [],
    files: { read: [], write: [] },
    network: [],
    environment: [],
    subprocess: false,
  }),
}).superRefine((manifest, context) => {
  if (manifest.runtime === 'executable' && !manifest.executable) {
    context.addIssue({ code: 'custom', path: ['executable'], message: 'executable is required for the executable runtime' })
  }
})
export type SkillManifest = z.infer<typeof SkillManifestSchema>

export const RetrievalStrategySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  parser: z.object({ name: z.string(), version: z.string() }),
  chunker: z.object({ name: z.string(), version: z.string(), chunkSize: z.number().int().positive(), overlap: z.number().int().nonnegative() }),
  retrieval: z.object({
    mode: z.enum(['dense', 'hybrid']),
    topK: z.number().int().positive(),
    threshold: z.number().min(0).max(1).optional(),
    rrfK: z.number().int().positive().optional(),
  }),
  embeddingProfile: z.string().min(1),
  sparseProfile: z.string().min(1).optional(),
  reranker: z.string().min(1).optional(),
  filters: JsonValueSchema.optional(),
})
export type RetrievalStrategy = z.infer<typeof RetrievalStrategySchema>

export const RetrievalEvalExpectedBehaviorSchema = z.enum(['answerable', 'no_answer', 'deny'])
export type RetrievalEvalExpectedBehavior = z.infer<typeof RetrievalEvalExpectedBehaviorSchema>

export const RetrievalEvalEvidenceLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive() }),
  z.object({ kind: z.literal('pdf'), page: z.number().int().positive(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('table'), page: z.number().int().positive().optional(), tableId: z.string().min(1), row: z.number().int().nonnegative().optional(), column: z.number().int().nonnegative().optional() }),
])
export type RetrievalEvalEvidenceLocator = z.infer<typeof RetrievalEvalEvidenceLocatorSchema>

export const RetrievalEvalEvidenceAnchorSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sourceVersion: z.string().min(1).optional(),
  locator: RetrievalEvalEvidenceLocatorSchema.optional(),
  quote: z.string().min(1),
  quoteHash: z.string().min(1).optional(),
})
export type RetrievalEvalEvidenceAnchor = z.infer<typeof RetrievalEvalEvidenceAnchorSchema>

export const RetrievalEvalEvidenceGroupSchema = z.object({
  id: z.string().min(1),
  factIds: z.array(z.string().min(1)).default([]),
  required: z.boolean().default(true),
  alternatives: z.array(RetrievalEvalEvidenceAnchorSchema).min(1),
})
export type RetrievalEvalEvidenceGroup = z.infer<typeof RetrievalEvalEvidenceGroupSchema>

export const RetrievalEvalSourceJudgmentSchema = z.object({
  documentId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  grade: z.number().int().min(0).max(3),
  reason: z.string().min(1).optional(),
})
export type RetrievalEvalSourceJudgment = z.infer<typeof RetrievalEvalSourceJudgmentSchema>

export const RetrievalEvalForbiddenSourceSchema = z.object({
  documentId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  reason: z.enum(['outdated', 'unauthorized', 'known_wrong', 'confuser']),
})
export type RetrievalEvalForbiddenSource = z.infer<typeof RetrievalEvalForbiddenSourceSchema>

export const RetrievalEvalPrincipalSchema = z.object({
  id: z.string().min(1),
  roles: z.array(z.string().min(1)).default([]),
  attributes: z.record(z.string(), JsonValueSchema).default({}),
})
export type RetrievalEvalPrincipal = z.infer<typeof RetrievalEvalPrincipalSchema>

export const LegacyRelevantSourceSchema = z.object({
  documentId: z.string().min(1),
  quote: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().positive().optional(),
})

export const RetrievalEvalCaseSchema = z.object({
  id: z.string().min(1),
  familyId: z.string().min(1).optional(),
  query: z.string().min(1),
  source: z.enum(['production_log', 'incident', 'expert', 'synthetic']).default('expert'),
  split: z.enum(['dev', 'regression', 'challenge']).default('dev'),
  risk: z.enum(['normal', 'high', 'critical']).default('normal'),
  expectedBehavior: RetrievalEvalExpectedBehaviorSchema.default('answerable'),
  expectedAnswerSummary: z.string().min(1).optional(),
  requiredFacts: z.array(z.object({ id: z.string().min(1), description: z.string().min(1) })).default([]),
  evidenceGroups: z.array(RetrievalEvalEvidenceGroupSchema).default([]),
  relevanceJudgments: z.array(RetrievalEvalSourceJudgmentSchema).default([]),
  forbiddenSources: z.array(RetrievalEvalForbiddenSourceSchema).default([]),
  slices: z.array(z.string().min(1)).default([]),
  principal: RetrievalEvalPrincipalSchema.optional(),
  /** Legacy V1 input. New datasets should use evidenceGroups. */
  relevantSources: z.array(LegacyRelevantSourceSchema).default([]),
}).superRefine((item, context) => {
  const evidenceCount = item.evidenceGroups.reduce((sum, group) => sum + group.alternatives.length, 0) + item.relevantSources.length
  if (item.expectedBehavior === 'answerable' && evidenceCount === 0) {
    context.addIssue({ code: 'custom', message: 'Answerable cases require at least one evidence anchor', path: ['evidenceGroups'] })
  }
  if (item.expectedBehavior !== 'answerable' && item.evidenceGroups.some((group) => group.required)) {
    context.addIssue({ code: 'custom', message: 'No-answer and deny cases cannot have required evidence groups', path: ['evidenceGroups'] })
  }
})
export type RetrievalEvalCase = z.infer<typeof RetrievalEvalCaseSchema>

export const EvaluationDatasetSchema = z.object({
  id: z.string().min(1),
  datasetId: z.string().min(1).optional(),
  version: z.number().int().positive().default(1),
  status: z.enum(['draft', 'in_review', 'published', 'retired']).default('draft'),
  knowledgeBaseId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  sourceManifestHash: z.string().min(1).optional(),
  metricSpecVersion: z.string().min(1).default('retrieval-v2.0'),
  queries: z.array(RetrievalEvalCaseSchema).min(1),
  createdAt: z.string().datetime().optional(),
  publishedAt: z.string().datetime().optional(),
})
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>

export const RetrievalEvalForbiddenHitsSchema = z.object({
  outdated: z.boolean(),
  unauthorized: z.boolean(),
  knownWrong: z.boolean(),
  confuser: z.boolean(),
})
export type RetrievalEvalForbiddenHits = z.infer<typeof RetrievalEvalForbiddenHitsSchema>

export const RetrievalEvalCaseMetricsSchema = z.object({
  docHit: z.number().min(0).max(1).nullable(),
  docRecall: z.number().min(0).max(1).nullable(),
  evidenceRecall: z.number().min(0).max(1).nullable(),
  completeEvidenceHit: z.number().min(0).max(1).nullable(),
  mrr: z.number().min(0).max(1).nullable(),
  ndcg: z.number().min(0).max(1).nullable(),
  newEvidencePrecision: z.number().min(0).max(1).nullable(),
  evidenceChunkPrecision: z.number().min(0).max(1).nullable(),
  redundancyRate: z.number().min(0).max(1).nullable(),
  noRelevantHit: z.number().min(0).max(1).nullable(),
  falseSupport: z.number().min(0).max(1).nullable(),
  correctNoEvidence: z.number().min(0).max(1).nullable(),
  minimalCompleteK: z.number().int().positive().nullable(),
  forbiddenHits: RetrievalEvalForbiddenHitsSchema,
})
export type RetrievalEvalCaseMetrics = z.infer<typeof RetrievalEvalCaseMetricsSchema>

export const RetrievalEvalChunkTraceSchema = z.object({
  rank: z.number().int().positive(),
  chunkId: z.string().min(1),
  documentId: z.string().min(1),
  sourceSha256: z.string().optional(),
  sourceVersion: z.string().optional(),
  content: z.string(),
  contentHash: z.string().min(1),
  score: z.number(),
  startIndex: z.number().int().nonnegative().optional(),
  endIndex: z.number().int().nonnegative().optional(),
  relevantGrade: z.number().int().min(0).max(3),
  matchedAnchorIds: z.array(z.string()),
  matchedGroupIds: z.array(z.string()),
  newlyCoveredGroupIds: z.array(z.string()),
  forbiddenReasons: z.array(z.enum(['outdated', 'unauthorized', 'known_wrong', 'confuser'])),
})
export type RetrievalEvalChunkTrace = z.infer<typeof RetrievalEvalChunkTraceSchema>

export const RetrievalEvalQueryTraceSchema = z.object({
  queryId: z.string().min(1),
  familyId: z.string().min(1),
  query: z.string().min(1),
  expectedBehavior: RetrievalEvalExpectedBehaviorSchema,
  risk: z.enum(['normal', 'high', 'critical']),
  split: z.enum(['dev', 'regression', 'challenge']),
  slices: z.array(z.string()),
  forbiddenReasonsExpected: z.array(z.enum(['outdated', 'unauthorized', 'known_wrong', 'confuser'])),
  latencyMs: z.number().nonnegative(),
  status: z.enum(['scored', 'infra_failed', 'invalid_gold']),
  candidateResults: z.array(RetrievalEvalChunkTraceSchema),
  finalResults: z.array(RetrievalEvalChunkTraceSchema),
  candidateMetricsByK: z.record(z.string(), RetrievalEvalCaseMetricsSchema),
  metricsByK: z.record(z.string(), RetrievalEvalCaseMetricsSchema),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type RetrievalEvalQueryTrace = z.infer<typeof RetrievalEvalQueryTraceSchema>

const NullableRateByKSchema = z.record(z.string(), z.number().min(0).max(1).nullable())

export const RetrievalEvaluationMetricsSchema = z.object({
  metricSpecVersion: z.string().min(1),
  kValues: z.array(z.number().int().positive()),
  caseCount: z.number().int().nonnegative(),
  familyCount: z.number().int().nonnegative(),
  answerableCaseCount: z.number().int().nonnegative(),
  noAnswerCaseCount: z.number().int().nonnegative(),
  infraFailureCount: z.number().int().nonnegative(),
  docHitAtK: NullableRateByKSchema,
  docRecallAtK: NullableRateByKSchema,
  evidenceRecallAtK: NullableRateByKSchema,
  completeEvidenceHitAtK: NullableRateByKSchema,
  mrrAtK: NullableRateByKSchema,
  ndcgByK: NullableRateByKSchema,
  newEvidencePrecisionAtK: NullableRateByKSchema,
  evidenceChunkPrecisionAtK: NullableRateByKSchema,
  redundancyRateAtK: NullableRateByKSchema,
  noRelevantHitRateAtK: NullableRateByKSchema,
  forbiddenHitRateAtK: z.record(z.string(), z.object({
    outdated: z.number().min(0).max(1).nullable(),
    unauthorized: z.number().min(0).max(1).nullable(),
    knownWrong: z.number().min(0).max(1).nullable(),
    confuser: z.number().min(0).max(1).nullable(),
  })),
  latencyP50Ms: z.number().nonnegative(),
  latencyP95Ms: z.number().nonnegative(),
  /** Legacy aliases retained for old SDK/UI clients. */
  recallAtK: z.number().min(0).max(1).optional(),
  mrr: z.number().min(0).max(1).optional(),
  ndcgAtK: z.number().min(0).max(1).optional(),
  zeroResultRate: z.number().min(0).max(1).optional(),
})
export type RetrievalEvaluationMetrics = z.infer<typeof RetrievalEvaluationMetricsSchema>

export const EvaluationRunSchema = z.object({
  id: z.string().min(1),
  datasetId: z.string().min(1),
  strategyVersionId: z.string().min(1),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  metrics: RetrievalEvaluationMetricsSchema.optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
})
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: JsonValueSchema.optional() }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

export const JobListSchema = z.object({
  data: z.array(JobSchema),
  nextCursor: z.string().optional(),
})
