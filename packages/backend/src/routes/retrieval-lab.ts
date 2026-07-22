import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import type { TaskRuntime } from '@manta/task-runtime'
import { EvaluationDatasetSchema, RetrievalStrategySchema } from '@manta/contracts'
import { z } from 'zod'
import { RetrievalLabStore } from '../core/engine/rag/retrieval-lab-store.js'

export interface RetrievalLabRoutesOptions { runtime: TaskRuntime; knowledgeRoot: string }

const IdParamsSchema = z.object({ id: z.string().min(1) })
const StrategyCreateSchema = RetrievalStrategySchema.omit({ id: true, version: true })
const DatasetCreateSchema = EvaluationDatasetSchema.omit({ id: true })
const EvaluationCreateSchema = z.object({ datasetId: z.string().min(1), strategyVersionIds: z.array(z.string().min(1)).min(1) })

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

  app.post('/v1/evaluation-datasets', async (request, reply) => {
    try { return reply.status(201).send({ data: store.createDataset({ id: randomUUID(), ...DatasetCreateSchema.parse(request.body) }) }) }
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
      if (!store.getDataset(input.datasetId)) return reply.status(404).send({ error: { code: 'EVALUATION_DATASET_NOT_FOUND', message: `Dataset ${input.datasetId} was not found` } })
      const submitted = input.strategyVersionIds.map((strategyVersionId) => {
        const run = store.createEvaluationRun(input.datasetId, strategyVersionId)
        const job = options.runtime.createJob({ kind: 'rag.evaluation.run', payload: { evaluationRunId: run.id }, metadata: { datasetId: input.datasetId, strategyVersionId, evaluationRunId: run.id }, maxAttempts: 3, idempotencyKey: `evaluation:${run.id}` })
        return { run, job }
      })
      return reply.status(202).send({ data: submitted })
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/v1/evaluations/compare', async (request) => {
    const ids = String((request.query as { ids?: string }).ids ?? '').split(',').filter(Boolean)
    return { data: ids.map((id) => store.getEvaluationRun(id)).filter(Boolean) }
  })
}

function sendError(reply: { status(code: number): { send(body: unknown): unknown } }, error: unknown): unknown {
  const code = error instanceof z.ZodError ? 'INVALID_REQUEST' : (error as { code?: string }).code ?? 'RETRIEVAL_LAB_FAILED'
  const status = code === 'INVALID_REQUEST' ? 400 : code === 'STRATEGY_NOT_READY' ? 409 : code.endsWith('NOT_FOUND') ? 404 : 500
  return reply.status(status).send({ error: { code, message: error instanceof Error ? error.message : String(error) } })
}
