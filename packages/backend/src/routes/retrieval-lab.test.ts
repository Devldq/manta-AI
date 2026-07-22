import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RetrievalLabStore } from '../core/engine/rag/retrieval-lab-store'
import { retrievalLabRoutes } from './retrieval-lab'

const SHA = 'a'.repeat(64)
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function fixture() {
  const knowledgeRoot = mkdtempSync(join(tmpdir(), 'manta-retrieval-lab-'))
  const runtime = {
    createJob: vi.fn((input: { kind: string }) => ({ id: `job-${input.kind}`, status: 'queued', progress: 0 })),
  }
  const app = Fastify()
  apps.push(app)
  void app.register(retrievalLabRoutes, { runtime: runtime as never, knowledgeRoot })
  return { app, runtime, store: new RetrievalLabStore(join(knowledgeRoot, 'retrieval-lab')) }
}

function datasetBody() {
  return {
    knowledgeBaseId: 'kb-1',
    name: '采购政策 Gold Set',
    metricSpecVersion: 'retrieval-v2.0',
    queries: [{
      id: 'case-1',
      familyId: 'purchase-threshold',
      query: '采购合同超过多少需要法务复核？',
      split: 'regression',
      risk: 'critical',
      expectedBehavior: 'answerable',
      requiredFacts: [{ id: 'threshold', description: '阈值是 50 万' }],
      evidenceGroups: [{
        id: 'threshold',
        factIds: ['threshold'],
        required: true,
        alternatives: [{ id: 'anchor-1', documentId: 'doc-2025', sourceSha256: SHA, quote: '超过 50 万需要法务复核' }],
      }],
      relevanceJudgments: [{ documentId: 'doc-2025', sourceSha256: SHA, grade: 3 }],
      forbiddenSources: [{ documentId: 'doc-2023', reason: 'outdated' }],
      slices: ['exact-number', 'date-sensitive'],
    }],
  }
}

describe('retrieval lab dataset versions', () => {
  it('requires publishing an immutable dataset version before evaluation', async () => {
    const { app, runtime } = fixture()
    const createdResponse = await app.inject({ method: 'POST', url: '/v1/evaluation-datasets', payload: datasetBody() })
    expect(createdResponse.statusCode).toBe(201)
    const created = createdResponse.json().data
    expect(created).toMatchObject({ datasetId: created.id, version: 1, status: 'draft', metricSpecVersion: 'retrieval-v2.0' })

    const rejected = await app.inject({ method: 'POST', url: '/v1/evaluations', payload: { datasetId: created.id, strategyVersionIds: ['strategy-1'] } })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error.code).toBe('EVALUATION_DATASET_NOT_PUBLISHED')

    const publishedResponse = await app.inject({ method: 'POST', url: `/v1/evaluation-datasets/${created.id}/publish` })
    expect(publishedResponse.statusCode).toBe(200)
    expect(publishedResponse.json().data.status).toBe('published')

    const submitted = await app.inject({ method: 'POST', url: '/v1/evaluations', payload: { datasetId: created.id, strategyVersionIds: ['strategy-1'], kValues: [10, 1, 5, 5] } })
    expect(submitted.statusCode).toBe(202)
    expect(submitted.json().data[0].run.kValues).toEqual([1, 5, 10])
    expect(runtime.createJob).toHaveBeenCalledOnce()
  })

  it('creates a new draft instead of mutating a published version', async () => {
    const { app } = fixture()
    const created = (await app.inject({ method: 'POST', url: '/v1/evaluation-datasets', payload: datasetBody() })).json().data
    await app.inject({ method: 'POST', url: `/v1/evaluation-datasets/${created.id}/publish` })

    const nextResponse = await app.inject({ method: 'POST', url: `/v1/evaluation-datasets/${created.id}/versions` })
    expect(nextResponse.statusCode).toBe(201)
    expect(nextResponse.json().data).toMatchObject({ datasetId: created.id, version: 2, status: 'draft' })

    const original = (await app.inject({ method: 'GET', url: `/v1/evaluation-datasets/${created.id}` })).json().data
    expect(original).toMatchObject({ version: 1, status: 'published' })
  })

  it('explains why two runs are not comparable', async () => {
    const { app, store } = fixture()
    const first = store.createEvaluationRun('dataset-1', 'strategy-1', [1, 3, 5], 'retrieval-v2.0')
    const second = store.createEvaluationRun('dataset-1', 'strategy-2', [1, 3, 5], 'retrieval-v2.0')
    store.updateEvaluationRun(first.id, { status: 'succeeded', sourceManifestHash: 'corpus-a' })
    store.updateEvaluationRun(second.id, { status: 'succeeded', sourceManifestHash: 'corpus-b' })

    const response = await app.inject({ method: 'GET', url: `/v1/evaluations/compare?ids=${first.id},${second.id}` })
    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ comparable: false, reasons: ['source_manifest_mismatch'] })
  })
})
