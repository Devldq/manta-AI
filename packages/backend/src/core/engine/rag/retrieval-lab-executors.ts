import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDocumentPipeline, type DocumentMetadata, type RetrievalResult } from '@manta/rag'
import { createQdrantProvider } from '@manta/rag/qdrant'
import type { JobExecutorRegistration } from '@manta/task-runtime'
import type { JsonValue } from '@manta/contracts'
import { getKnowledgeBase } from '../../storage/knowledge-base/store.js'
import { buildEmbeddingService } from '../../../routes/rag.js'
import { RagSourceAssetStore } from '../../../storage/rag-source-assets.js'
import { RetrievalLabStore, type EvaluationQueryResult } from './retrieval-lab-store.js'

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
      const queryResults: EvaluationQueryResult[] = []
      try {
        await provider.initialize()
        for (let index = 0; index < dataset.queries.length; index++) {
          context.signal.throwIfAborted()
          const item = dataset.queries[index]
          const started = performance.now()
          const embedding = await embeddingService.embed(item.query)
          const retrieved = strategy.retrieval.mode === 'hybrid'
            ? await provider.hybridSearch(dataset.knowledgeBaseId, embedding, item.query, { topK: strategy.retrieval.topK, threshold: strategy.retrieval.threshold, rrfK: strategy.retrieval.rrfK, includeMetadata: true })
            : await provider.vectorSearch(dataset.knowledgeBaseId, embedding, { topK: strategy.retrieval.topK, threshold: strategy.retrieval.threshold, includeMetadata: true })
          const latencyMs = performance.now() - started
          queryResults.push(scoreQuery(item, retrieved, latencyMs))
          context.checkpoint('query_evaluated', { queryId: item.id, index: index + 1, total: dataset.queries.length })
          context.progress((index + 1) / dataset.queries.length, { queryId: item.id, latencyMs })
        }
        const latencies = queryResults.map((item) => item.latencyMs).sort((left, right) => left - right)
        const metrics = {
          recallAtK: average(queryResults.map((item) => item.recall)),
          mrr: average(queryResults.map((item) => item.reciprocalRank)),
          ndcgAtK: average(queryResults.map((item) => item.ndcg)),
          zeroResultRate: queryResults.filter((item) => !item.retrieved.length).length / queryResults.length,
          latencyP50Ms: percentile(latencies, 0.5),
          latencyP95Ms: percentile(latencies, 0.95),
        }
        store.updateEvaluationRun(run.id, { status: 'succeeded', queries: queryResults, metrics, completedAt: new Date().toISOString(), error: undefined })
        store.updateStrategy(strategy.id, { evaluationSummary: metrics })
        return { evaluationRunId: run.id, strategyVersionId: strategy.id, metrics } as JsonValue
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

function scoreQuery(item: { id: string; query: string; relevantSources: Array<{ documentId: string; quote: string }> }, results: RetrievalResult[], latencyMs: number): EvaluationQueryResult {
  const relevantDocs = new Set(item.relevantSources.map((source) => source.documentId))
  const retrieved = results.map((result) => {
    const sources = item.relevantSources.filter((source) => source.documentId === result.chunk.documentId)
    const relevant = sources.some((source) => textOverlaps(result.chunk.content, source.quote))
    return { documentId: result.chunk.documentId, content: result.chunk.content, score: result.score, relevant }
  })
  const matchedDocs = new Set(retrieved.filter((result) => result.relevant).map((result) => result.documentId))
  const firstRelevant = retrieved.findIndex((result) => result.relevant)
  const dcg = retrieved.reduce((sum, result, index) => sum + (result.relevant ? 1 / Math.log2(index + 2) : 0), 0)
  const idealRelevant = Math.min(relevantDocs.size, retrieved.length)
  const idcg = Array.from({ length: idealRelevant }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0)
  return {
    queryId: item.id,
    query: item.query,
    latencyMs,
    retrieved,
    recall: relevantDocs.size ? matchedDocs.size / relevantDocs.size : 0,
    reciprocalRank: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    ndcg: idcg ? dcg / idcg : 0,
  }
}

function textOverlaps(content: string, quote: string): boolean {
  const left = content.replace(/\s+/g, ' ').trim().toLowerCase()
  const right = quote.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!left || !right) return false
  if (left.includes(right) || right.includes(left)) return true
  const window = Math.min(24, right.length)
  for (let index = 0; index + window <= right.length; index += Math.max(1, Math.floor(window / 2))) if (left.includes(right.slice(index, index + window))) return true
  return false
}

function chunkerName(name: string): 'fixed' | 'semantic' | 'recursive' { return name === 'fixed' ? 'fixed' : name === 'paragraph-v1' || name === 'semantic' ? 'semantic' : 'recursive' }
function stringField(value: JsonValue, field: string): string { if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value[field] !== 'string') throw new Error(`${field} is required`); return value[field] }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function percentile(values: number[], quantile: number): number { if (!values.length) return 0; return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))] }
