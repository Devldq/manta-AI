import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDocumentPipeline, type DocumentMetadata, type RetrievalResult } from '@manta/rag'
import { createQdrantProvider } from '@manta/rag/qdrant'
import type { JobExecutorRegistration } from '@manta/task-runtime'
import type { JsonValue, RetrievalEvalCase, RetrievalEvalQueryTrace } from '@manta/contracts'
import { getKnowledgeBase } from '../../storage/knowledge-base/store.js'
import { buildEmbeddingService } from '../../../routes/rag.js'
import { RagSourceAssetStore } from '../../../storage/rag-source-assets.js'
import { RetrievalLabStore } from './retrieval-lab-store.js'
import { aggregateRetrievalMetrics, scoreRetrievalCase, type ScorableRetrievedChunk } from './retrieval-evaluation-scorer.js'

export interface RetrievalLabExecutorRoots { knowledge: string }

export function createStrategyBuildExecutor(roots: RetrievalLabExecutorRoots): JobExecutorRegistration {
  return {
    kind: 'rag.strategy.build',
    interruption: 'retry-safe',
    async execute(context) {
      const strategyVersionId = stringField(context.job.payload, 'strategyVersionId')
      const store = new RetrievalLabStore(join(roots.knowledge, 'retrieval-lab'))
      let strategy = store.getStrategy(strategyVersionId)
      if (!strategy) throw new Error(`Strategy ${strategyVersionId} was not found`)
      const knowledgeBase = await getKnowledgeBase(strategy.knowledgeBaseId)
      if (!knowledgeBase) throw new Error(`Knowledge base ${strategy.knowledgeBaseId} was not found`)
      const sourceProvider = createQdrantProvider()
      const targetProvider = createQdrantProvider({ collectionPrefix: strategy.indexPrefix })
      const sourceAssets = new RagSourceAssetStore(join(roots.knowledge, 'source-assets'))
      try {
        await Promise.all([sourceProvider.initialize(), targetProvider.initialize()])
        await targetProvider.createKnowledgeBase(strategy.knowledgeBaseId, `${knowledgeBase.name} / ${strategy.name}`, knowledgeBase.config)
        const available = (await sourceProvider.getDocuments(strategy.knowledgeBaseId)).filter((document) => document.status === 'ready' && document.sourceSha256)
        const snapshot = strategy.corpusSnapshot.length ? strategy.corpusSnapshot : available.map((document) => ({ documentId: document.id, sourceSha256: document.sourceSha256!, size: document.size }))
        strategy = store.updateStrategy(strategy.id, { status: 'building', corpusSnapshot: snapshot, error: undefined })
        context.checkpoint('corpus_snapshot', { documents: snapshot.length })
        const embeddingService = buildEmbeddingService(knowledgeBase.config)
        for (let index = 0; index < snapshot.length; index++) {
          context.signal.throwIfAborted()
          const item = snapshot[index]
          const source = available.find((document) => document.id === item.documentId && document.sourceSha256 === item.sourceSha256)
          if (!source) throw new Error(`Corpus source ${item.documentId} is unavailable or changed`)
          const asset = await sourceAssets.read(`source.${item.sourceSha256}`)
          const metadata: DocumentMetadata = { ...source, status: 'processing' }
          const pipeline = createDocumentPipeline({
            embeddingService,
            ragProvider: targetProvider,
            chunkStrategy: chunkerName(strategy.chunker.name),
            chunkSize: strategy.chunker.chunkSize,
            chunkOverlap: strategy.chunker.overlap,
            signal: context.signal,
          })
          const result = await pipeline.process(await readFile(asset.path), metadata, strategy.knowledgeBaseId)
          context.checkpoint('document_indexed', { documentId: item.documentId, index: index + 1, total: snapshot.length, chunkCount: result.chunkCount })
          context.progress((index + 1) / Math.max(1, snapshot.length), { documentId: item.documentId })
        }
        const ready = store.updateStrategy(strategy.id, { status: 'ready', indexReference: `${strategy.indexPrefix}${strategy.knowledgeBaseId}`, error: undefined })
        return { strategyVersionId: ready.id, status: ready.status, indexReference: ready.indexReference, corpusDocuments: snapshot.length } as JsonValue
      } catch (error) {
        if (context.signal.aborted) {
          await targetProvider.deleteKnowledgeBase(strategy.knowledgeBaseId).catch(() => undefined)
          store.updateStrategy(strategy.id, { status: 'draft', error: undefined, indexReference: undefined })
          throw context.signal.reason
        }
        store.updateStrategy(strategy.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally {
        await Promise.allSettled([sourceProvider.close(), targetProvider.close()])
      }
    },
  }
}

export function createEvaluationExecutor(roots: RetrievalLabExecutorRoots): JobExecutorRegistration {
  return {
    kind: 'rag.evaluation.run',
    interruption: 'retry-safe',
    async execute(context) {
      const runId = stringField(context.job.payload, 'evaluationRunId')
      const store = new RetrievalLabStore(join(roots.knowledge, 'retrieval-lab'))
      const run = store.getEvaluationRun(runId)
      if (!run) throw new Error(`Evaluation run ${runId} was not found`)
      const dataset = store.getDataset(run.datasetId)
      const strategy = store.getStrategy(run.strategyVersionId)
      if (!dataset || !strategy || strategy.status !== 'ready') throw new Error('Evaluation dataset or ready strategy is unavailable')
      const knowledgeBase = await getKnowledgeBase(dataset.knowledgeBaseId)
      if (!knowledgeBase) throw new Error(`Knowledge base ${dataset.knowledgeBaseId} was not found`)
      const provider = createQdrantProvider({ collectionPrefix: strategy.indexPrefix })
      const embeddingService = buildEmbeddingService(knowledgeBase.config)
      const queryResults: RetrievalEvalQueryTrace[] = []
      try {
        await provider.initialize()
        const sourceManifestHash = corpusManifestHash(strategy.corpusSnapshot)
        if (dataset.sourceManifestHash && dataset.sourceManifestHash !== sourceManifestHash) {
          throw Object.assign(new Error('Dataset source manifest does not match the strategy corpus'), { code: 'EVALUATION_CORPUS_MISMATCH' })
        }
        const maxK = Math.max(strategy.retrieval.topK, ...run.kValues)
        const sourceHashes = new Map(strategy.corpusSnapshot.map((item) => [item.documentId, item.sourceSha256]))
        for (let index = 0; index < dataset.queries.length; index++) {
          context.signal.throwIfAborted()
          const item = dataset.queries[index]
          const started = performance.now()
          try {
            const embedding = await embeddingService.embed(item.query)
            const retrieved = strategy.retrieval.mode === 'hybrid'
              ? await provider.hybridSearch(dataset.knowledgeBaseId, embedding, item.query, { topK: maxK, threshold: strategy.retrieval.threshold, rrfK: strategy.retrieval.rrfK, includeMetadata: true })
              : await provider.vectorSearch(dataset.knowledgeBaseId, embedding, { topK: maxK, threshold: strategy.retrieval.threshold, includeMetadata: true })
            const latencyMs = performance.now() - started
            const scorable = retrieved.map((result): ScorableRetrievedChunk => ({
              chunkId: result.chunk.id,
              documentId: result.chunk.documentId,
              content: result.chunk.content,
              score: result.score,
              sourceSha256: result.chunk.sourceSha256 ?? sourceHashes.get(result.chunk.documentId),
              sourceVersion: result.chunk.sourceVersion,
              startIndex: result.chunk.startIndex,
              endIndex: result.chunk.endIndex,
            }))
            queryResults.push(scoreRetrievalCase({ case: item, candidateResults: scorable, finalResults: scorable, latencyMs, kValues: run.kValues }))
            context.checkpoint('query_evaluated', { queryId: item.id, index: index + 1, total: dataset.queries.length })
            context.progress((index + 1) / dataset.queries.length, { queryId: item.id, latencyMs })
          } catch (error) {
            if (context.signal.aborted) throw error
            queryResults.push(failedQueryTrace(item, run.kValues, performance.now() - started, error))
            context.checkpoint('query_failed', { queryId: item.id, index: index + 1, total: dataset.queries.length, error: error instanceof Error ? error.message : String(error) })
            context.progress((index + 1) / dataset.queries.length, { queryId: item.id, failed: true })
          }
        }
        const metrics = aggregateRetrievalMetrics(queryResults, run.kValues, run.metricSpecVersion)
        const slices = unique(queryResults.flatMap((item) => item.slices))
        const sliceMetrics = Object.fromEntries(slices.map((slice) => [slice, aggregateRetrievalMetrics(queryResults.filter((item) => item.slices.includes(slice)), run.kValues, run.metricSpecVersion)]))
        store.updateEvaluationRun(run.id, { status: 'succeeded', sourceManifestHash, queries: queryResults, metrics, sliceMetrics, completedAt: new Date().toISOString(), error: undefined })
        store.updateStrategy(strategy.id, { evaluationSummary: metrics })
        return { evaluationRunId: run.id, strategyVersionId: strategy.id, sourceManifestHash, metrics } as JsonValue
      } catch (error) {
        store.updateEvaluationRun(run.id, { status: 'failed', queries: queryResults, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) })
        throw error
      } finally { await provider.close() }
    },
  }
}

export async function searchStrategy(roots: RetrievalLabExecutorRoots, strategyVersionId: string, query: string): Promise<{ results: RetrievalResult[]; strategyVersionId: string }> {
  const store = new RetrievalLabStore(join(roots.knowledge, 'retrieval-lab'))
  const strategy = store.getStrategy(strategyVersionId)
  if (!strategy || strategy.status !== 'ready') throw new Error(`Ready strategy ${strategyVersionId} was not found`)
  const knowledgeBase = await getKnowledgeBase(strategy.knowledgeBaseId)
  if (!knowledgeBase) throw new Error(`Knowledge base ${strategy.knowledgeBaseId} was not found`)
  const provider = createQdrantProvider({ collectionPrefix: strategy.indexPrefix })
  try {
    const embedding = await buildEmbeddingService(knowledgeBase.config).embed(query)
    const results = strategy.retrieval.mode === 'hybrid'
      ? await provider.hybridSearch(strategy.knowledgeBaseId, embedding, query, { topK: strategy.retrieval.topK, threshold: strategy.retrieval.threshold, rrfK: strategy.retrieval.rrfK, includeMetadata: true })
      : await provider.vectorSearch(strategy.knowledgeBaseId, embedding, { topK: strategy.retrieval.topK, threshold: strategy.retrieval.threshold, includeMetadata: true })
    return { results, strategyVersionId: strategy.id }
  } finally { await provider.close() }
}

function chunkerName(name: string): 'fixed' | 'semantic' | 'recursive' { return name === 'fixed' ? 'fixed' : name === 'paragraph-v1' || name === 'semantic' ? 'semantic' : 'recursive' }
function stringField(value: JsonValue, field: string): string { if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value[field] !== 'string') throw new Error(`${field} is required`); return value[field] }

function failedQueryTrace(item: RetrievalEvalCase, kValues: number[], latencyMs: number, error: unknown): RetrievalEvalQueryTrace {
  return {
    queryId: item.id,
    familyId: item.familyId ?? item.id,
    query: item.query,
    expectedBehavior: item.expectedBehavior,
    risk: item.risk,
    split: item.split,
    slices: item.slices,
    forbiddenReasonsExpected: unique(item.forbiddenSources.map((source) => source.reason)),
    latencyMs,
    status: error instanceof Error && error.name === 'ZodError' ? 'invalid_gold' : 'infra_failed',
    candidateResults: [],
    finalResults: [],
    candidateMetricsByK: Object.fromEntries(kValues.map((k) => [String(k), emptyMetrics()])),
    metricsByK: Object.fromEntries(kValues.map((k) => [String(k), emptyMetrics()])),
    error: { code: (error as { code?: string }).code ?? 'RETRIEVAL_QUERY_FAILED', message: error instanceof Error ? error.message : String(error) },
  }
}

function emptyMetrics() {
  return {
    docHit: null, docRecall: null, evidenceRecall: null, completeEvidenceHit: null, mrr: null, ndcg: null,
    newEvidencePrecision: null, evidenceChunkPrecision: null, redundancyRate: null, noRelevantHit: null,
    falseSupport: null, correctNoEvidence: null, minimalCompleteK: null,
    forbiddenHits: { outdated: false, unauthorized: false, knownWrong: false, confuser: false },
  }
}

function corpusManifestHash(snapshot: Array<{ documentId: string; sourceSha256: string; size: number }>): string {
  return createHash('sha256').update(JSON.stringify([...snapshot].sort((left, right) => left.documentId.localeCompare(right.documentId)))).digest('hex')
}

function unique<T>(values: T[]): T[] { return [...new Set(values)] }
