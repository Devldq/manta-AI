import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import type { TaskRuntime } from '@manta/task-runtime'
import { EvaluationDatasetSchema, RetrievalStrategySchema } from '@manta/contracts'
import { z } from 'zod'
import { RetrievalLabStore } from '../core/engine/rag/retrieval-lab-store.js'
import { DEFAULT_RETRIEVAL_K_VALUES, RETRIEVAL_METRIC_SPEC_VERSION } from '../core/engine/rag/retrieval-evaluation-scorer.js'

export interface RetrievalLabRoutesOptions { runtime: TaskRuntime; knowledgeRoot: string }

const IdParamsSchema = z.object({ id: z.string().min(1) })
const StrategyCreateSchema = RetrievalStrategySchema.omit({ id: true, version: true })
const DatasetCreateSchema = EvaluationDatasetSchema.omit({ id: true, datasetId: true, version: true, status: true, createdAt: true, publishedAt: true })
const EvaluationCreateSchema = z.object({
  datasetId: z.string().min(1),
  strategyVersionIds: z.array(z.string().min(1)).min(1),
  kValues: z.array(z.number().int().positive().max(100)).min(1).default([...DEFAULT_RETRIEVAL_K_VALUES]),
})

export const retrievalLabRoutes: FastifyPluginAsync<RetrievalLabRoutesOptions> = async (app, options) => {
  const store = new RetrievalLabStore(join(options.knowledgeRoot, 'retrieval-lab'))

  app.get('/v1/knowledge-bases/:id/strategies', async (request) => ({ data: store.listStrategies(IdParamsSchema.parse(request.params).id), activeStrategyVersionId: store.activeStrategy(IdParamsSchema.parse(request.params).id)?.id }))

  app.post('/v1/knowledge-bases/:id/strategies', async (request, reply) => {
    try { return reply.status(201).send({ data: store.createStrategy(IdParamsSchema.parse(request.params).id, StrategyCreateSchema.parse(request.body)) }) }
    catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/strategies/:id/build', async (request, reply) => {
    try {
      const id = IdParamsSchema.parse(request.params).id
      const strategy = store.getStrategy(id)
      if (!strategy) return reply.status(404).send({ error: { code: 'STRATEGY_NOT_FOUND', message: `Strategy ${id} was not found` } })
      const job = options.runtime.createJob({ kind: 'rag.strategy.build', payload: { strategyVersionId: id }, metadata: { knowledgeBaseId: strategy.knowledgeBaseId, strategyVersionId: id }, maxAttempts: 3, idempotencyKey: `strategy-build:${id}` })
      return reply.status(202).send({ data: job })
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/strategies/:id/activate', async (request, reply) => {
    try {
      const id = IdParamsSchema.parse(request.params).id
      const strategy = store.getStrategy(id)
      if (!strategy) return reply.status(404).send({ error: { code: 'STRATEGY_NOT_FOUND', message: `Strategy ${id} was not found` } })
      return { data: store.activateStrategy(strategy.knowledgeBaseId, id) }
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/evaluation-datasets', async (request) => ({ data: store.listDatasets((request.query as { knowledgeBaseId?: string }).knowledgeBaseId) }))

  app.get('/v1/evaluation-datasets/:id', async (request, reply) => {
    const id = IdParamsSchema.parse(request.params).id
    const dataset = store.getDataset(id)
    return dataset ? { data: dataset } : reply.status(404).send({ error: { code: 'EVALUATION_DATASET_NOT_FOUND', message: `Dataset ${id} was not found` } })
  })

  app.post('/v1/evaluation-datasets', async (request, reply) => {
    try {
      const id = randomUUID()
      return reply.status(201).send({ data: store.createDataset({ id, datasetId: id, version: 1, status: 'draft', ...DatasetCreateSchema.parse(request.body) }) })
    }
    catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/evaluation-datasets/:id/publish', async (request, reply) => {
    try { return { data: store.publishDataset(IdParamsSchema.parse(request.params).id) } }
    catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/evaluation-datasets/:id/versions', async (request, reply) => {
    try { return reply.status(201).send({ data: store.createDatasetVersion(IdParamsSchema.parse(request.params).id) }) }
    catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/evaluation-runs/:id', async (request, reply) => {
    const id = IdParamsSchema.parse(request.params).id
    const run = store.getEvaluationRun(id)
    return run ? { data: run } : reply.status(404).send({ error: { code: 'EVALUATION_RUN_NOT_FOUND', message: `Evaluation run ${id} was not found` } })
  })

  app.get('/v1/evaluation-runs', async (request) => {
    const datasetId = (request.query as { datasetId?: string }).datasetId
    return { data: store.listEvaluationRuns(datasetId) }
  })

  app.post('/v1/evaluations', async (request, reply) => {
    try {
      const input = EvaluationCreateSchema.parse(request.body)
      const dataset = store.getDataset(input.datasetId)
      if (!dataset) return reply.status(404).send({ error: { code: 'EVALUATION_DATASET_NOT_FOUND', message: `Dataset ${input.datasetId} was not found` } })
      if (dataset.status !== 'published') return reply.status(409).send({ error: { code: 'EVALUATION_DATASET_NOT_PUBLISHED', message: 'Only a published dataset version can be evaluated' } })
      const submitted = input.strategyVersionIds.map((strategyVersionId) => {
        const run = store.createEvaluationRun(input.datasetId, strategyVersionId, [...new Set(input.kValues)].sort((left, right) => left - right), dataset.metricSpecVersion || RETRIEVAL_METRIC_SPEC_VERSION)
        const job = options.runtime.createJob({ kind: 'rag.evaluation.run', payload: { evaluationRunId: run.id }, metadata: { datasetId: input.datasetId, strategyVersionId, evaluationRunId: run.id }, maxAttempts: 3, idempotencyKey: `evaluation:${run.id}` })
        return { run, job }
      })
      return reply.status(202).send({ data: submitted })
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/evaluations/compare', async (request) => {
    const ids = String((request.query as { ids?: string }).ids ?? '').split(',').filter(Boolean)
    const runs = ids.map((id) => store.getEvaluationRun(id)).filter((run): run is NonNullable<typeof run> => Boolean(run))
    const reasons: string[] = []
    if (new Set(runs.map((run) => run.datasetId)).size > 1) reasons.push('dataset_version_mismatch')
    if (new Set(runs.map((run) => run.sourceManifestHash).filter(Boolean)).size > 1) reasons.push('source_manifest_mismatch')
    if (new Set(runs.map((run) => run.metricSpecVersion)).size > 1) reasons.push('metric_spec_mismatch')
    if (new Set(runs.map((run) => JSON.stringify(run.kValues))).size > 1) reasons.push('k_grid_mismatch')
    if (runs.some((run) => run.status !== 'succeeded' || (run.metrics?.infraFailureCount ?? 0) > 0)) reasons.push('incomplete_run')
    return { data: { runs, comparable: runs.length > 1 && reasons.length === 0, reasons } }
  })
}

function sendError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown): unknown {
  const code = error instanceof z.ZodError ? 'INVALID_REQUEST' : (error as { code?: string }).code ?? 'RETRIEVAL_LAB_FAILED'
  const status = code === 'INVALID_REQUEST' ? 400 : code === 'STRATEGY_NOT_READY' ? 409 : code.endsWith('NOT_FOUND') ? 404 : 500
  return reply.status(status).send({ error: { code, message: error instanceof Error ? error.message : String(error) } })
}
