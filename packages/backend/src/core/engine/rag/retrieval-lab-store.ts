import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EvaluationDatasetSchema,
  RetrievalStrategySchema,
  type EvaluationDataset,
  type JsonValue,
  type RetrievalEvalQueryTrace,
  type RetrievalEvaluationMetrics,
  type RetrievalStrategy,
} from '@manta/contracts'
import { durableAtomicWrite, durableMkdir } from '../../../storage/durable-atomic.js'

export type StrategyBuildStatus = 'draft' | 'building' | 'ready' | 'failed'

export interface StrategyVersion extends RetrievalStrategy {
  knowledgeBaseId: string
  status: StrategyBuildStatus
  indexPrefix: string
  indexReference?: string
  corpusSnapshot: Array<{ documentId: string; sourceSha256: string; size: number }>
  evaluationSummary?: RetrievalEvaluationMetrics
  createdAt: string
  updatedAt: string
  error?: string
}

export interface StoredEvaluationRun {
  id: string
  datasetId: string
  strategyVersionId: string
  status: 'running' | 'succeeded' | 'failed'
  kValues: number[]
  metricSpecVersion: string
  sourceManifestHash?: string
  metrics?: RetrievalEvaluationMetrics
  sliceMetrics?: Record<string, RetrievalEvaluationMetrics>
  queries: RetrievalEvalQueryTrace[]
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
    const now = new Date().toISOString()
    const parsed = EvaluationDatasetSchema.parse({
      ...input,
      id: input.id || randomUUID(),
      datasetId: input.datasetId || input.id,
      status: input.status ?? 'draft',
      createdAt: input.createdAt ?? now,
    })
    this.write('datasets', parsed.id, parsed)
    return parsed
  }

  getDataset(id: string): EvaluationDataset | undefined {
    const raw = this.read<Record<string, unknown>>('datasets', id)
    if (!raw) return undefined
    const parsed = EvaluationDatasetSchema.parse(raw)
    if (!('status' in raw)) return { ...parsed, datasetId: parsed.datasetId ?? parsed.id, status: 'published' }
    return { ...parsed, datasetId: parsed.datasetId ?? parsed.id }
  }

  listDatasets(knowledgeBaseId?: string): EvaluationDataset[] {
    return this.list<Record<string, unknown>>('datasets')
      .map((item) => {
        const parsed = EvaluationDatasetSchema.parse(item)
        return !('status' in item) ? { ...parsed, datasetId: parsed.datasetId ?? parsed.id, status: 'published' as const } : { ...parsed, datasetId: parsed.datasetId ?? parsed.id }
      })
      .filter((item) => !knowledgeBaseId || item.knowledgeBaseId === knowledgeBaseId)
      .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
  }

  publishDataset(id: string): EvaluationDataset {
    const current = this.getDataset(id)
    if (!current) throw Object.assign(new Error(`Dataset ${id} was not found`), { code: 'EVALUATION_DATASET_NOT_FOUND' })
    if (current.status === 'published') return current
    const published = EvaluationDatasetSchema.parse({ ...current, status: 'published', publishedAt: new Date().toISOString() })
    this.write('datasets', id, published)
    return published
  }

  createDatasetVersion(id: string): EvaluationDataset {
    const current = this.getDataset(id)
    if (!current) throw Object.assign(new Error(`Dataset ${id} was not found`), { code: 'EVALUATION_DATASET_NOT_FOUND' })
    const datasetId = current.datasetId ?? current.id
    const nextVersion = Math.max(...this.listDatasets(current.knowledgeBaseId).filter((item) => (item.datasetId ?? item.id) === datasetId).map((item) => item.version), 0) + 1
    return this.createDataset({
      ...current,
      id: randomUUID(),
      datasetId,
      version: nextVersion,
      status: 'draft',
      publishedAt: undefined,
      createdAt: new Date().toISOString(),
    })
  }

  createEvaluationRun(datasetId: string, strategyVersionId: string, kValues: number[], metricSpecVersion: string): StoredEvaluationRun {
    const run: StoredEvaluationRun = { id: randomUUID(), datasetId, strategyVersionId, status: 'running', kValues, metricSpecVersion, queries: [], createdAt: new Date().toISOString() }
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
