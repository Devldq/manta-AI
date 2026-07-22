import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EvaluationDatasetSchema, RetrievalStrategySchema, type EvaluationDataset, type RetrievalStrategy, type JsonValue } from '@manta/contracts'
import { durableAtomicWrite, durableMkdir } from '../../../storage/durable-atomic.js'

export type StrategyBuildStatus = 'draft' | 'building' | 'ready' | 'failed'

export interface StrategyVersion extends RetrievalStrategy {
  knowledgeBaseId: string
  status: StrategyBuildStatus
  indexPrefix: string
  indexReference?: string
  corpusSnapshot: Array<{ documentId: string; sourceSha256: string; size: number }>
  evaluationSummary?: Record<string, number>
  createdAt: string
  updatedAt: string
  error?: string
}

export interface EvaluationQueryResult {
  queryId: string
  query: string
  latencyMs: number
  retrieved: Array<{ documentId: string; content: string; score: number; relevant: boolean }>
  recall: number
  reciprocalRank: number
  ndcg: number
}

export interface StoredEvaluationRun {
  id: string
  datasetId: string
  strategyVersionId: string
  status: 'running' | 'succeeded' | 'failed'
  metrics?: { recallAtK: number; mrr: number; ndcgAtK: number; zeroResultRate: number; latencyP50Ms: number; latencyP95Ms: number }
  queries: EvaluationQueryResult[]
  createdAt: string
  completedAt?: string
  error?: string
}

export class RetrievalLabStore {
  constructor(private readonly root: string) {}

  createStrategy(knowledgeBaseId: string, input: Omit<RetrievalStrategy, 'id' | 'version'>): StrategyVersion {
    const versions = this.listStrategies(knowledgeBaseId)
    const parsed = RetrievalStrategySchema.omit({ id: true, version: true }).parse(input)
    const now = new Date().toISOString()
    const id = randomUUID()
    const strategy: StrategyVersion = {
      ...parsed,
      id,
      version: (versions.at(-1)?.version ?? 0) + 1,
      knowledgeBaseId,
      status: 'draft',
      indexPrefix: `manta_strategy_${id.replaceAll('-', '_')}_`,
      corpusSnapshot: [],
      createdAt: now,
      updatedAt: now,
    }
    this.write('strategies', id, strategy)
    return strategy
  }

  getStrategy(id: string): StrategyVersion | undefined { return this.read<StrategyVersion>('strategies', id) }

  listStrategies(knowledgeBaseId?: string): StrategyVersion[] {
    return this.list<StrategyVersion>('strategies').filter((item) => !knowledgeBaseId || item.knowledgeBaseId === knowledgeBaseId).sort((left, right) => left.version - right.version)
  }

  updateStrategy(id: string, patch: Partial<Pick<StrategyVersion, 'status' | 'indexReference' | 'corpusSnapshot' | 'evaluationSummary' | 'error'>>): StrategyVersion {
    const current = this.getStrategy(id)
    if (!current) throw Object.assign(new Error(`Strategy ${id} was not found`), { code: 'STRATEGY_NOT_FOUND' })
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this.write('strategies', id, updated)
    return updated
  }

  activateStrategy(knowledgeBaseId: string, id: string): StrategyVersion {
    const strategy = this.getStrategy(id)
    if (!strategy || strategy.knowledgeBaseId !== knowledgeBaseId) throw Object.assign(new Error(`Strategy ${id} was not found`), { code: 'STRATEGY_NOT_FOUND' })
    if (strategy.status !== 'ready') throw Object.assign(new Error('Only a ready strategy can be activated'), { code: 'STRATEGY_NOT_READY' })
    const active = this.read<Record<string, string>>('state', 'active-strategies') ?? {}
    this.write('state', 'active-strategies', { ...active, [knowledgeBaseId]: id })
    return strategy
  }

  activeStrategy(knowledgeBaseId: string): StrategyVersion | undefined {
    const id = this.read<Record<string, string>>('state', 'active-strategies')?.[knowledgeBaseId]
    return id ? this.getStrategy(id) : undefined
  }

  createDataset(input: EvaluationDataset): EvaluationDataset {
    const parsed = EvaluationDatasetSchema.parse({ ...input, id: input.id || randomUUID() })
    this.write('datasets', parsed.id, parsed)
    return parsed
  }

  getDataset(id: string): EvaluationDataset | undefined { return this.read<EvaluationDataset>('datasets', id) }
  listDatasets(knowledgeBaseId?: string): EvaluationDataset[] { return this.list<EvaluationDataset>('datasets').filter((item) => !knowledgeBaseId || item.knowledgeBaseId === knowledgeBaseId) }

  createEvaluationRun(datasetId: string, strategyVersionId: string): StoredEvaluationRun {
    const run: StoredEvaluationRun = { id: randomUUID(), datasetId, strategyVersionId, status: 'running', queries: [], createdAt: new Date().toISOString() }
    this.write('runs', run.id, run)
    return run
  }

  getEvaluationRun(id: string): StoredEvaluationRun | undefined { return this.read<StoredEvaluationRun>('runs', id) }
  listEvaluationRuns(datasetId?: string): StoredEvaluationRun[] { return this.list<StoredEvaluationRun>('runs').filter((item) => !datasetId || item.datasetId === datasetId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)) }

  updateEvaluationRun(id: string, patch: Partial<StoredEvaluationRun>): StoredEvaluationRun {
    const current = this.getEvaluationRun(id)
    if (!current) throw Object.assign(new Error(`Evaluation run ${id} was not found`), { code: 'EVALUATION_RUN_NOT_FOUND' })
    const updated = { ...current, ...patch }
    this.write('runs', id, updated)
    return updated
  }

  private directory(kind: string): string { return join(this.root, kind) }
  private path(kind: string, id: string): string { assertId(id); return join(this.directory(kind), `${id}.json`) }
  private write(kind: string, id: string, value: JsonValue | object): void { durableMkdir(this.directory(kind)); durableAtomicWrite(this.path(kind, id), `${JSON.stringify(value, null, 2)}\n`) }
  private read<T>(kind: string, id: string): T | undefined { const path = this.path(kind, id); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : undefined }
  private list<T>(kind: string): T[] { const directory = this.directory(kind); if (!existsSync(directory)) return []; return readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => this.read<T>(kind, name.slice(0, -5))).filter((item): item is T => Boolean(item)) }
}

function assertId(id: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('Unsafe Retrieval Lab identifier') }
