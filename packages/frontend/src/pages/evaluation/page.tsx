import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Target,
  X,
} from 'lucide-react'

type KnowledgeBase = { id: string; name: string; documentCount?: number }
type DocumentInfo = { id: string; name: string; status: string; sourceSha256?: string }
type StrategyStatus = 'draft' | 'building' | 'ready' | 'failed'
type Strategy = {
  id: string
  version: number
  name: string
  status: StrategyStatus
  chunker: { name: string; version: string; chunkSize: number; overlap: number }
  retrieval: { mode: 'dense' | 'hybrid'; topK: number; threshold?: number; rrfK?: number }
  indexReference?: string
  corpusSnapshot: Array<{ documentId: string }>
  evaluationSummary?: Metrics
  error?: string
}
type Dataset = {
  id: string
  datasetId?: string
  version: number
  status: 'draft' | 'in_review' | 'published' | 'retired'
  knowledgeBaseId: string
  name: string
  metricSpecVersion: string
  queries: DatasetCase[]
}
type EvidenceAnchor = { id: string; documentId: string; sourceSha256?: string; quote: string }
type DraftEvidence = EvidenceAnchor & { groupId: string }
type ForbiddenReason = 'outdated' | 'unauthorized' | 'known_wrong' | 'confuser'
type DatasetCase = {
  id: string
  familyId?: string
  query: string
  source: 'production_log' | 'incident' | 'expert' | 'synthetic'
  split: 'dev' | 'regression' | 'challenge'
  risk: 'normal' | 'high' | 'critical'
  expectedBehavior: 'answerable' | 'no_answer' | 'deny'
  expectedAnswerSummary?: string
  requiredFacts: Array<{ id: string; description: string }>
  evidenceGroups: Array<{ id: string; factIds: string[]; required: boolean; alternatives: EvidenceAnchor[] }>
  relevanceJudgments: Array<{ documentId: string; sourceSha256?: string; grade: number; reason?: string }>
  forbiddenSources: Array<{ documentId: string; sourceSha256?: string; reason: ForbiddenReason }>
  slices: string[]
  relevantSources: Array<{ documentId: string; quote: string }>
}
type Metrics = {
  metricSpecVersion: string
  kValues: number[]
  caseCount: number
  familyCount: number
  answerableCaseCount: number
  noAnswerCaseCount: number
  infraFailureCount: number
  docHitAtK: Record<string, number | null>
  docRecallAtK: Record<string, number | null>
  evidenceRecallAtK: Record<string, number | null>
  completeEvidenceHitAtK: Record<string, number | null>
  mrrAtK: Record<string, number | null>
  ndcgByK: Record<string, number | null>
  newEvidencePrecisionAtK: Record<string, number | null>
  evidenceChunkPrecisionAtK: Record<string, number | null>
  redundancyRateAtK: Record<string, number | null>
  noRelevantHitRateAtK: Record<string, number | null>
  forbiddenHitRateAtK: Record<string, { outdated: number | null; unauthorized: number | null; knownWrong: number | null; confuser: number | null }>
  latencyP50Ms: number
  latencyP95Ms: number
  recallAtK?: number
  mrr?: number
  ndcgAtK?: number
  zeroResultRate?: number
}
type EvaluationRun = {
  id: string
  datasetId: string
  strategyVersionId: string
  status: 'running' | 'succeeded' | 'failed'
  kValues: number[]
  metricSpecVersion: string
  sourceManifestHash?: string
  metrics?: Metrics
  sliceMetrics?: Record<string, Metrics>
  queries: Array<{
    queryId: string
    familyId: string
    query: string
    expectedBehavior: 'answerable' | 'no_answer' | 'deny'
    risk: 'normal' | 'high' | 'critical'
    slices: string[]
    latencyMs: number
    status: 'scored' | 'infra_failed' | 'invalid_gold'
    metricsByK: Record<string, CaseMetrics>
    finalResults: Array<ChunkTrace>
    error?: { code: string; message: string }
  }>
  createdAt: string
  completedAt?: string
  error?: string
}
type CaseMetrics = {
  docHit: number | null
  docRecall: number | null
  evidenceRecall: number | null
  completeEvidenceHit: number | null
  mrr: number | null
  ndcg: number | null
  newEvidencePrecision: number | null
  evidenceChunkPrecision: number | null
  redundancyRate: number | null
  forbiddenHits: { outdated: boolean; unauthorized: boolean; knownWrong: boolean; confuser: boolean }
}
type ChunkTrace = {
  rank: number
  chunkId: string
  documentId: string
  content: string
  score: number
  relevantGrade: number
  matchedGroupIds: string[]
  newlyCoveredGroupIds: string[]
  forbiddenReasons: ForbiddenReason[]
}
type Job = { id: string; status: string; progress?: number; error?: { message?: string } }

const fieldClass = 'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent'
const buttonClass = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-primary transition hover:bg-border-subtle disabled:cursor-not-allowed disabled:opacity-45'
const primaryButtonClass = 'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-text-inverse transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `请求失败 (${response.status})`)
  return body.data as T
}

async function waitForJob(id: string, onChange?: (job: Job) => void): Promise<Job> {
  while (true) {
    const job = await api<Job>(`/v1/jobs/${encodeURIComponent(id)}`)
    onChange?.(job)
    if (['succeeded', 'failed', 'cancelled', 'recovery_required'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

function percent(value: number | null | undefined): string { return value === undefined || value === null ? '—' : `${(value * 100).toFixed(1)}%` }
function latency(value: number | undefined): string { return value === undefined ? '—' : `${Math.round(value)} ms` }
function shortId(id: string): string { return id.slice(0, 8) }
function atK(values: Record<string, number | null> | undefined, k = 5): number | null | undefined { return values?.[String(k)] }

export default function EvaluationPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [activeStrategyId, setActiveStrategyId] = useState<string>()
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [datasetId, setDatasetId] = useState('')
  const [runs, setRuns] = useState<EvaluationRun[]>([])
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const [strategyName, setStrategyName] = useState('')
  const [chunker, setChunker] = useState<'recursive' | 'fixed' | 'paragraph-v1'>('recursive')
  const [chunkSize, setChunkSize] = useState(512)
  const [overlap, setOverlap] = useState(64)
  const [topK, setTopK] = useState(8)
  const [threshold, setThreshold] = useState(0.25)
  const [retrievalMode, setRetrievalMode] = useState<'dense' | 'hybrid'>('dense')
  const [showStrategyForm, setShowStrategyForm] = useState(false)

  const [datasetName, setDatasetName] = useState('')
  const [query, setQuery] = useState('')
  const [familyId, setFamilyId] = useState('')
  const [expectedBehavior, setExpectedBehavior] = useState<DatasetCase['expectedBehavior']>('answerable')
  const [expectedAnswerSummary, setExpectedAnswerSummary] = useState('')
  const [caseSplit, setCaseSplit] = useState<DatasetCase['split']>('dev')
  const [caseRisk, setCaseRisk] = useState<DatasetCase['risk']>('normal')
  const [caseSlices, setCaseSlices] = useState('')
  const [evidenceGroupId, setEvidenceGroupId] = useState('fact-1')
  const [documentId, setDocumentId] = useState('')
  const [quote, setQuote] = useState('')
  const [draftEvidence, setDraftEvidence] = useState<DraftEvidence[]>([])
  const [forbiddenDocumentId, setForbiddenDocumentId] = useState('')
  const [forbiddenReason, setForbiddenReason] = useState<ForbiddenReason>('outdated')
  const [draftForbidden, setDraftForbidden] = useState<DatasetCase['forbiddenSources']>([])
  const [draftQueries, setDraftQueries] = useState<Dataset['queries']>([])
  const [showDatasetForm, setShowDatasetForm] = useState(false)

  const loadKnowledgeBases = useCallback(async () => {
    setLoading(true)
    try {
      const values = await api<KnowledgeBase[]>('/v1/knowledge-bases')
      setKnowledgeBases(values)
      setKnowledgeBaseId((current) => current || values[0]?.id || '')
      setError(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }, [])

  const loadLab = useCallback(async (kbId: string) => {
    if (!kbId) return
    setLoading(true)
    try {
      const [strategyBody, datasetValues, documentsBody] = await Promise.all([
        fetch(`/v1/knowledge-bases/${encodeURIComponent(kbId)}/strategies`).then(async (response) => {
          const body = await response.json()
          if (!response.ok) throw new Error(body.error?.message ?? '策略读取失败')
          return body as { data: Strategy[]; activeStrategyVersionId?: string }
        }),
        api<Dataset[]>(`/v1/evaluation-datasets?knowledgeBaseId=${encodeURIComponent(kbId)}`),
        fetch(`/api/rag/knowledge-bases/${encodeURIComponent(kbId)}/documents`).then((response) => response.json()),
      ])
      setStrategies(strategyBody.data)
      setActiveStrategyId(strategyBody.activeStrategyVersionId)
      setDatasets(datasetValues)
      setDocuments(documentsBody.data?.documents ?? [])
      setSelectedStrategies((current) => current.filter((id) => strategyBody.data.some((strategy) => strategy.id === id && strategy.status === 'ready')))
      setDatasetId((current) => datasetValues.some((dataset) => dataset.id === current) ? current : datasetValues[0]?.id || '')
      setError(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }, [])

  const loadRuns = useCallback(async (selectedDatasetId: string) => {
    if (!selectedDatasetId) { setRuns([]); return }
    try { setRuns(await api<EvaluationRun[]>(`/v1/evaluation-runs?datasetId=${encodeURIComponent(selectedDatasetId)}`)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [])

  useEffect(() => { void loadKnowledgeBases() }, [loadKnowledgeBases])
  useEffect(() => { void loadLab(knowledgeBaseId) }, [knowledgeBaseId, loadLab])
  useEffect(() => { void loadRuns(datasetId) }, [datasetId, loadRuns])

  const readyStrategies = useMemo(() => strategies.filter((strategy) => strategy.status === 'ready'), [strategies])
  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId)
  const expandedRun = runs.find((run) => run.id === expandedRunId)

  async function createStrategy() {
    if (!strategyName.trim()) return setError('请填写策略名称')
    setBusy('create-strategy')
    try {
      await api<Strategy>(`/v1/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/strategies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          name: strategyName.trim(),
          parser: { name: 'auto', version: '1' },
          chunker: { name: chunker, version: '1', chunkSize, overlap },
          retrieval: { mode: retrievalMode, topK, threshold, ...(retrievalMode === 'hybrid' ? { rrfK: 60 } : {}) },
          embeddingProfile: 'knowledge-base-default',
          ...(retrievalMode === 'hybrid' ? { sparseProfile: 'bm25-v1' } : {}),
        }),
      })
      setStrategyName(''); setShowStrategyForm(false); await loadLab(knowledgeBaseId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  async function buildStrategy(strategy: Strategy) {
    setBusy(`build:${strategy.id}`)
    try {
      const job = await api<Job>(`/v1/strategies/${encodeURIComponent(strategy.id)}/build`, { method: 'POST' })
      const completed = await waitForJob(job.id)
      if (completed.status !== 'succeeded') throw new Error(completed.error?.message ?? `构建任务状态：${completed.status}`)
      await loadLab(knowledgeBaseId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  async function activateStrategy(strategy: Strategy) {
    setBusy(`activate:${strategy.id}`)
    try {
      await api<Strategy>(`/v1/strategies/${encodeURIComponent(strategy.id)}/activate`, { method: 'POST' })
      await loadLab(knowledgeBaseId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  function addDraftEvidence() {
    if (!evidenceGroupId.trim() || !documentId || !quote.trim()) return setError('证据组、相关文档和原文依据都必须填写')
    const document = documents.find((item) => item.id === documentId)
    setDraftEvidence((current) => [...current, {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
      groupId: evidenceGroupId.trim(),
      documentId,
      sourceSha256: document?.sourceSha256,
      quote: quote.trim(),
    }])
    setQuote('')
  }

  function addDraftForbidden() {
    if (!forbiddenDocumentId) return setError('请选择禁止来源')
    const document = documents.find((item) => item.id === forbiddenDocumentId)
    setDraftForbidden((current) => [...current, { documentId: forbiddenDocumentId, sourceSha256: document?.sourceSha256, reason: forbiddenReason }])
    setForbiddenDocumentId('')
  }

  function addDraftQuery() {
    if (!query.trim()) return setError('请填写测试查询')
    if (expectedBehavior === 'answerable' && !draftEvidence.length) return setError('可回答 Case 至少需要一条 Gold Evidence')
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`
    const groupIds = [...new Set(draftEvidence.map((item) => item.groupId))]
    const evidenceGroups = groupIds.map((groupId) => ({
      id: groupId,
      factIds: [groupId],
      required: true,
      alternatives: draftEvidence.filter((item) => item.groupId === groupId).map(({ groupId: _groupId, ...anchor }) => anchor),
    }))
    const judgedDocuments = [...new Map(draftEvidence.map((item) => [item.documentId, item])).values()]
    setDraftQueries((current) => [...current, {
      id,
      familyId: familyId.trim() || id,
      query: query.trim(),
      source: 'expert',
      split: caseSplit,
      risk: caseRisk,
      expectedBehavior,
      expectedAnswerSummary: expectedAnswerSummary.trim() || undefined,
      requiredFacts: groupIds.map((groupId) => ({ id: groupId, description: groupId })),
      evidenceGroups: expectedBehavior === 'answerable' ? evidenceGroups : [],
      relevanceJudgments: expectedBehavior === 'answerable' ? judgedDocuments.map((item) => ({ documentId: item.documentId, sourceSha256: item.sourceSha256, grade: 3 })) : [],
      forbiddenSources: draftForbidden,
      slices: caseSlices.split(',').map((item) => item.trim()).filter(Boolean),
      relevantSources: [],
    }])
    setQuery(''); setFamilyId(''); setExpectedAnswerSummary(''); setCaseSlices(''); setDraftEvidence([]); setDraftForbidden([])
  }

  async function createDataset() {
    if (!datasetName.trim() || !draftQueries.length) return setError('评测集名称和至少一条查询是必填项')
    setBusy('create-dataset')
    try {
      const created = await api<Dataset>('/v1/evaluation-datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ knowledgeBaseId, name: datasetName.trim(), metricSpecVersion: 'retrieval-v2.0', queries: draftQueries }),
      })
      setDatasetName(''); setDraftQueries([]); setShowDatasetForm(false)
      await loadLab(knowledgeBaseId); setDatasetId(created.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  async function publishDataset() {
    if (!selectedDataset || selectedDataset.status === 'published') return
    setBusy('publish-dataset')
    try {
      await api<Dataset>(`/v1/evaluation-datasets/${encodeURIComponent(selectedDataset.id)}/publish`, { method: 'POST' })
      await loadLab(knowledgeBaseId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  async function runEvaluation() {
    if (!datasetId || !selectedStrategies.length) return setError('请选择评测集和至少一个已就绪策略')
    if (selectedDataset?.status !== 'published') return setError('请先发布当前评测集版本')
    setBusy('run-evaluation')
    try {
      const submitted = await api<Array<{ run: EvaluationRun; job: Job }>>('/v1/evaluations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId, strategyVersionIds: selectedStrategies, kValues: [1, 3, 5, 10] }),
      })
      setRuns((current) => [...submitted.map((item) => item.run), ...current])
      await Promise.all(submitted.map((item) => waitForJob(item.job.id)))
      await Promise.all([loadRuns(datasetId), loadLab(knowledgeBaseId)])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent"><FlaskConical size={19} /></div>
            <div><h1 className="text-lg font-semibold tracking-tight">召回评测</h1><p className="text-xs text-text-muted">在本地语料上构建、比较并激活可复现的检索策略</p></div>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="知识库" className={`${fieldClass} min-w-48`} value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}>
              {!knowledgeBases.length && <option value="">暂无知识库</option>}
              {knowledgeBases.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
            <button className={buttonClass} title="刷新" onClick={() => void loadLab(knowledgeBaseId)} disabled={!knowledgeBaseId || loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 p-6">
        {error && <div className="flex items-start justify-between gap-4 rounded-lg border border-status-failed/30 bg-status-failed/10 px-4 py-3 text-sm text-status-failed"><span>{error}</span><button onClick={() => setError(undefined)}><X size={15} /></button></div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard icon={<Layers3 size={15} />} label="策略版本" value={String(strategies.length)} detail={`${readyStrategies.length} 个已就绪`} />
          <MetricCard icon={<Target size={15} />} label="当前生产策略" value={activeStrategyId ? `v${strategies.find((item) => item.id === activeStrategyId)?.version ?? '?'}` : '默认'} detail={activeStrategyId ? strategies.find((item) => item.id === activeStrategyId)?.name : 'legacy-default'} />
          <MetricCard icon={<SearchCheck size={15} />} label="评测集" value={String(datasets.length)} detail={`${selectedDataset?.queries.length ?? 0} 条当前查询`} />
          <MetricCard icon={<Activity size={15} />} label="历史运行" value={String(runs.length)} detail={`${runs.filter((run) => run.status === 'succeeded').length} 次已完成`} />
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <SectionHeader title="策略版本" description="每个版本拥有独立索引；激活只切换引用，不覆盖旧版本。" action={<button className={primaryButtonClass} onClick={() => setShowStrategyForm((value) => !value)} disabled={!knowledgeBaseId}><Plus size={14} />新建策略</button>} />
          {showStrategyForm && <div className="grid gap-3 border-b border-border bg-border-subtle/35 p-4 md:grid-cols-3 xl:grid-cols-6">
            <label className="text-xs text-text-muted md:col-span-2">名称<input className={`${fieldClass} mt-1`} value={strategyName} onChange={(event) => setStrategyName(event.target.value)} placeholder="例如：段落分块 512" /></label>
            <label className="text-xs text-text-muted">分块器<select className={`${fieldClass} mt-1`} value={chunker} onChange={(event) => setChunker(event.target.value as typeof chunker)}><option value="recursive">递归分块</option><option value="fixed">固定长度</option><option value="paragraph-v1">自然段落</option></select></label>
            <NumberField label="块大小" value={chunkSize} onChange={setChunkSize} min={64} />
            <NumberField label="重叠" value={overlap} onChange={setOverlap} min={0} />
            <div className="grid grid-cols-2 gap-2"><NumberField label="Top K" value={topK} onChange={setTopK} min={1} /><label className="text-xs text-text-muted">阈值<input className={`${fieldClass} mt-1`} type="number" min="0" max="1" step="0.05" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label></div>
            <label className="text-xs text-text-muted md:col-span-2">召回模式<select className={`${fieldClass} mt-1`} value={retrievalMode} onChange={(event) => setRetrievalMode(event.target.value as typeof retrievalMode)}><option value="dense">Dense 向量</option><option value="hybrid">Dense + BM25 + RRF</option></select></label>
            <div className="flex gap-2 md:col-span-3 xl:col-span-6"><button className={primaryButtonClass} onClick={() => void createStrategy()} disabled={busy === 'create-strategy'}>{busy === 'create-strategy' && <LoaderCircle size={14} className="animate-spin" />}保存不可变版本</button><button className={buttonClass} onClick={() => setShowStrategyForm(false)}>取消</button></div>
          </div>}
          <div className="divide-y divide-border">
            {!strategies.length && <EmptyState text="还没有检索策略。新建后构建独立索引，再使用评测集验证效果。" />}
            {strategies.map((strategy) => {
              const active = strategy.id === activeStrategyId
              const checked = selectedStrategies.includes(strategy.id)
              return <div key={strategy.id} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[28px_minmax(200px,1.3fr)_1fr_1fr_1fr_auto]">
                <input aria-label={`选择 ${strategy.name}`} type="checkbox" checked={checked} disabled={strategy.status !== 'ready'} onChange={() => setSelectedStrategies((current) => checked ? current.filter((id) => id !== strategy.id) : [...current, strategy.id])} className="h-4 w-4 accent-[var(--color-accent)]" />
                <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{strategy.name}</span><span className="rounded bg-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-muted">v{strategy.version}</span>{active && <span className="rounded bg-accent-subtle px-1.5 py-0.5 text-[10px] font-medium text-accent">使用中</span>}</div><p className="mt-1 truncate font-mono text-[10px] text-text-muted">{shortId(strategy.id)} · {strategy.corpusSnapshot.length} docs</p></div>
                <div className="text-xs"><p className="text-text-secondary">{chunkerLabel(strategy.chunker.name)}</p><p className="mt-1 text-text-muted">{strategy.chunker.chunkSize} / {strategy.chunker.overlap}</p></div>
                <div className="text-xs"><p className="text-text-secondary">{strategy.retrieval.mode} · Top {strategy.retrieval.topK}</p><p className="mt-1 text-text-muted">threshold {strategy.retrieval.threshold ?? 0}</p></div>
                <div className="text-xs"><StatusBadge status={strategy.status} /><p className="mt-1 text-text-muted">Evidence@5 {percent(atK(strategy.evaluationSummary?.evidenceRecallAtK) ?? strategy.evaluationSummary?.recallAtK)}</p></div>
                <div className="flex justify-end gap-2">{strategy.status !== 'ready' ? <button className={buttonClass} disabled={Boolean(busy)} onClick={() => void buildStrategy(strategy)}>{busy === `build:${strategy.id}` ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}构建</button> : <button className={buttonClass} disabled={active || Boolean(busy)} onClick={() => void activateStrategy(strategy)}>{active ? <Check size={14} /> : <RotateCcw size={14} />}{active ? '已激活' : '激活'}</button>}</div>
                {strategy.error && <p className="text-xs text-status-failed md:col-start-2 md:col-span-5">{strategy.error}</p>}
              </div>
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <SectionHeader title="Gold Set" description="以 Case Family、证据组和原文锚点定义 Ground Truth；草稿发布后才允许运行。" action={<button className={buttonClass} onClick={() => setShowDatasetForm((value) => !value)} disabled={!knowledgeBaseId}><Plus size={14} />新建评测集</button>} />
          {showDatasetForm && <div className="space-y-3 border-b border-border bg-border-subtle/35 p-4">
            <label className="block max-w-xl text-xs text-text-muted">评测集名称<input className={`${fieldClass} mt-1`} value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="例如：Manta 核心能力问答" /></label>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-text-muted xl:col-span-2">测试查询<input className={`${fieldClass} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户会怎样提问？" /></label>
              <label className="text-xs text-text-muted">Case Family<input className={`${fieldClass} mt-1`} value={familyId} onChange={(event) => setFamilyId(event.target.value)} placeholder="同一意图的改写使用相同 ID" /></label>
              <label className="text-xs text-text-muted">预期行为<select className={`${fieldClass} mt-1`} value={expectedBehavior} onChange={(event) => setExpectedBehavior(event.target.value as DatasetCase['expectedBehavior'])}><option value="answerable">应可回答</option><option value="no_answer">应无答案</option><option value="deny">应拒绝</option></select></label>
              <label className="text-xs text-text-muted xl:col-span-2">答案要点<input className={`${fieldClass} mt-1`} value={expectedAnswerSummary} onChange={(event) => setExpectedAnswerSummary(event.target.value)} placeholder="简述正确答案应覆盖的事实（可选）" /></label>
              <label className="text-xs text-text-muted">数据分层<select className={`${fieldClass} mt-1`} value={caseSplit} onChange={(event) => setCaseSplit(event.target.value as DatasetCase['split'])}><option value="dev">Dev</option><option value="regression">Regression</option><option value="challenge">Challenge</option></select></label>
              <label className="text-xs text-text-muted">风险等级<select className={`${fieldClass} mt-1`} value={caseRisk} onChange={(event) => setCaseRisk(event.target.value as DatasetCase['risk'])}><option value="normal">普通</option><option value="high">高风险</option><option value="critical">关键</option></select></label>
              <label className="text-xs text-text-muted xl:col-span-4">Slices<input className={`${fieldClass} mt-1`} value={caseSlices} onChange={(event) => setCaseSlices(event.target.value)} placeholder="多个切片用逗号分隔，例如：中文, 多跳, 配置问题" /></label>
            </div>
            {expectedBehavior === 'answerable' && <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium">Gold Evidence</p><p className="mt-1 text-[11px] text-text-muted">同一证据组内是可替代锚点；不同证据组代表必须分别覆盖的事实。</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_260px_1fr_auto]">
                <label className="text-xs text-text-muted">证据组 ID<input className={`${fieldClass} mt-1`} value={evidenceGroupId} onChange={(event) => setEvidenceGroupId(event.target.value)} placeholder="fact-1" /></label>
                <label className="text-xs text-text-muted">相关文档<select className={`${fieldClass} mt-1`} value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">选择已入库文档</option>{documents.filter((document) => document.status === 'ready').map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
                <label className="text-xs text-text-muted">原文锚点<input className={`${fieldClass} mt-1`} value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="粘贴策略无关的原文片段" /></label>
                <button className={`${buttonClass} self-end`} onClick={addDraftEvidence}><Plus size={14} />添加证据</button>
              </div>
              {draftEvidence.length > 0 && <div className="mt-3 divide-y divide-border rounded-md border border-border">{draftEvidence.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs"><div className="min-w-0"><p className="font-medium">{item.groupId} · {documents.find((document) => document.id === item.documentId)?.name ?? shortId(item.documentId)}</p><p className="mt-1 line-clamp-2 text-text-muted">{item.quote}</p></div><button className="text-text-muted hover:text-status-failed" onClick={() => setDraftEvidence((current) => current.filter((evidence) => evidence.id !== item.id))}><X size={14} /></button></div>)}</div>}
            </div>}
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium">禁止来源（可选）</p><p className="mt-1 text-[11px] text-text-muted">标记过期、无权限、已知错误或专门用于混淆的来源，单独统计污染率。</p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px_auto]">
                <label className="text-xs text-text-muted">文档<select className={`${fieldClass} mt-1`} value={forbiddenDocumentId} onChange={(event) => setForbiddenDocumentId(event.target.value)}><option value="">选择禁止来源</option>{documents.filter((document) => document.status === 'ready').map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
                <label className="text-xs text-text-muted">原因<select className={`${fieldClass} mt-1`} value={forbiddenReason} onChange={(event) => setForbiddenReason(event.target.value as ForbiddenReason)}><option value="outdated">过期</option><option value="unauthorized">无权限</option><option value="known_wrong">已知错误</option><option value="confuser">混淆来源</option></select></label>
                <button className={`${buttonClass} self-end`} onClick={addDraftForbidden}><Plus size={14} />添加</button>
              </div>
              {draftForbidden.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{draftForbidden.map((item, index) => <span key={`${item.documentId}-${index}`} className="inline-flex items-center gap-2 rounded bg-status-failed/10 px-2 py-1 text-[11px] text-status-failed">{documents.find((document) => document.id === item.documentId)?.name ?? shortId(item.documentId)} · {forbiddenReasonLabel(item.reason)}<button onClick={() => setDraftForbidden((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button></span>)}</div>}
            </div>
            <button className={buttonClass} onClick={addDraftQuery}><Plus size={14} />加入 Case</button>
            {draftQueries.length > 0 && <div className="divide-y divide-border rounded-lg border border-border bg-surface">{draftQueries.map((item, index) => <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs"><div><p className="font-medium">{index + 1}. {item.query}</p><p className="mt-1 text-text-muted">{behaviorLabel(item.expectedBehavior)} · family {shortId(item.familyId ?? item.id)} · {item.evidenceGroups.length} 个证据组 · {riskLabel(item.risk)}{item.slices.length ? ` · ${item.slices.join(' / ')}` : ''}</p></div><button className="text-text-muted hover:text-status-failed" onClick={() => setDraftQueries((current) => current.filter((queryItem) => queryItem.id !== item.id))}><X size={14} /></button></div>)}</div>}
            <div className="flex gap-2"><button className={primaryButtonClass} onClick={() => void createDataset()} disabled={busy === 'create-dataset'}>保存评测集</button><button className={buttonClass} onClick={() => setShowDatasetForm(false)}>取消</button></div>
          </div>}
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
            <label className="min-w-64 flex-1 text-xs text-text-muted">当前评测集<select className={`${fieldClass} mt-1`} value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="">选择评测集</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · v{dataset.version} · {statusLabel(dataset.status)} · {dataset.queries.length} cases</option>)}</select></label>
            <div className="flex-1 text-xs text-text-muted"><p>待比较策略</p><p className="mt-2 text-sm text-text-secondary">{selectedStrategies.length ? selectedStrategies.map((id) => `v${strategies.find((strategy) => strategy.id === id)?.version}`).join('、') : '在上方勾选已就绪策略'}</p></div>
            {selectedDataset && selectedDataset.status !== 'published' && <button className={buttonClass} disabled={Boolean(busy)} onClick={() => void publishDataset()}>{busy === 'publish-dataset' ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}发布 v{selectedDataset.version}</button>}
            <button className={primaryButtonClass} disabled={!datasetId || selectedDataset?.status !== 'published' || !selectedStrategies.length || Boolean(busy)} onClick={() => void runEvaluation()}>{busy === 'run-evaluation' ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}运行 K=1/3/5/10</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <SectionHeader title="评测结果" description="指标和逐 Query 召回内容都会保存在本地，可以重新打开比较。" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-border bg-border-subtle/50 text-text-muted"><tr><th className="w-10 px-4 py-2.5"></th><th className="px-3 py-2.5 font-medium">策略</th><th className="px-3 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">Complete@5</th><th className="px-3 py-2.5 font-medium">Evidence@5</th><th className="px-3 py-2.5 font-medium">MRR@5</th><th className="px-3 py-2.5 font-medium">nDCG@5</th><th className="px-3 py-2.5 font-medium">New Evidence@5</th><th className="px-3 py-2.5 font-medium">P95</th><th className="px-3 py-2.5 font-medium">运行时间</th></tr></thead>
              <tbody className="divide-y divide-border">{runs.map((run) => {
                const strategy = strategies.find((item) => item.id === run.strategyVersionId)
                const expanded = run.id === expandedRunId
                return <tr key={run.id} className="cursor-pointer hover:bg-border-subtle/35" onClick={() => setExpandedRunId(expanded ? undefined : run.id)}><td className="px-4 py-3 text-text-muted">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td><td className="px-3 py-3"><p className="font-medium">{strategy?.name ?? shortId(run.strategyVersionId)}</p><p className="mt-1 font-mono text-[10px] text-text-muted">{strategy ? `v${strategy.version}` : shortId(run.strategyVersionId)} · {run.metricSpecVersion}</p></td><td className="px-3 py-3"><StatusBadge status={run.status} /></td><td className="px-3 py-3 font-mono">{percent(atK(run.metrics?.completeEvidenceHitAtK))}</td><td className="px-3 py-3 font-mono">{percent(atK(run.metrics?.evidenceRecallAtK))}</td><td className="px-3 py-3 font-mono">{percent(atK(run.metrics?.mrrAtK))}</td><td className="px-3 py-3 font-mono">{percent(atK(run.metrics?.ndcgByK))}</td><td className="px-3 py-3 font-mono">{percent(atK(run.metrics?.newEvidencePrecisionAtK))}</td><td className="px-3 py-3 font-mono">{latency(run.metrics?.latencyP95Ms)}</td><td className="px-3 py-3 text-text-muted">{new Date(run.createdAt).toLocaleString()}</td></tr>
              })}</tbody>
            </table>
            {!runs.length && <EmptyState text={datasetId ? '这个评测集还没有运行记录。' : '选择一个评测集查看可复现的历史结果。'} />}
          </div>
          {expandedRun && <div className="border-t border-border bg-border-subtle/25 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">逐 Query Trace</h3><span className="font-mono text-[10px] text-text-muted">run {shortId(expandedRun.id)} · K {expandedRun.kValues.join('/')}{expandedRun.sourceManifestHash ? ` · corpus ${shortId(expandedRun.sourceManifestHash)}` : ''}</span></div>
            {expandedRun.sliceMetrics && Object.keys(expandedRun.sliceMetrics).length > 0 && <div className="mb-3 overflow-x-auto rounded-lg border border-border bg-surface"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-border bg-border-subtle/50 text-text-muted"><tr><th className="px-3 py-2 font-medium">Slice</th><th className="px-3 py-2 font-medium">Cases</th><th className="px-3 py-2 font-medium">Complete@5</th><th className="px-3 py-2 font-medium">Evidence@5</th><th className="px-3 py-2 font-medium">MRR@5</th><th className="px-3 py-2 font-medium">P95</th></tr></thead><tbody className="divide-y divide-border">{Object.entries(expandedRun.sliceMetrics).map(([slice, metrics]) => <tr key={slice}><td className="px-3 py-2 font-medium">{slice}</td><td className="px-3 py-2 font-mono">{metrics.caseCount}</td><td className="px-3 py-2 font-mono">{percent(atK(metrics.completeEvidenceHitAtK))}</td><td className="px-3 py-2 font-mono">{percent(atK(metrics.evidenceRecallAtK))}</td><td className="px-3 py-2 font-mono">{percent(atK(metrics.mrrAtK))}</td><td className="px-3 py-2 font-mono">{latency(metrics.latencyP95Ms)}</td></tr>)}</tbody></table></div>}
            <div className="space-y-3">{expandedRun.queries.map((item) => {
              const metrics = item.metricsByK['5']
              return <div key={item.queryId} className="rounded-lg border border-border bg-surface p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-medium">{item.query}</p><p className="mt-1 text-[11px] text-text-muted">family {shortId(item.familyId)} · {behaviorLabel(item.expectedBehavior)} · {riskLabel(item.risk)}{item.slices.length ? ` · ${item.slices.join(' / ')}` : ''}</p></div><div className="text-right text-[11px] text-text-muted"><StatusBadge status={item.status} /><p className="mt-1">Evidence {percent(metrics?.evidenceRecall)} · Complete {percent(metrics?.completeEvidenceHit)} · MRR {percent(metrics?.mrr)} · nDCG {percent(metrics?.ndcg)} · {latency(item.latencyMs)}</p></div></div>
                {item.error && <p className="mt-3 rounded-md bg-status-failed/10 px-3 py-2 text-xs text-status-failed">{item.error.code}: {item.error.message}</p>}
                <div className="mt-3 space-y-2">{item.finalResults.map((result) => {
                  const relevant = result.matchedGroupIds.length > 0 || result.relevantGrade > 0
                  const forbidden = result.forbiddenReasons.length > 0
                  return <div key={`${result.chunkId}-${result.rank}`} className={`rounded-md border px-3 py-2 text-xs ${forbidden ? 'border-status-failed/35 bg-status-failed/5' : relevant ? 'border-accent/35 bg-accent-subtle/45' : 'border-border bg-background'}`}><div className="mb-1 flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-text-muted">#{result.rank} · doc {shortId(result.documentId)} · chunk {shortId(result.chunkId)}</span><span className={forbidden ? 'text-status-failed' : relevant ? 'text-accent' : 'text-text-muted'}>grade {result.relevantGrade} · {result.score.toFixed(3)}</span></div>{(result.matchedGroupIds.length > 0 || forbidden) && <p className="mb-1 text-[11px] text-text-muted">{result.matchedGroupIds.length > 0 ? `覆盖 ${result.matchedGroupIds.join(', ')}` : ''}{result.newlyCoveredGroupIds.length > 0 ? ` · 新增 ${result.newlyCoveredGroupIds.join(', ')}` : ''}{forbidden ? ` · 禁止来源：${result.forbiddenReasons.map(forbiddenReasonLabel).join(', ')}` : ''}</p>}<p className="line-clamp-3 leading-5 text-text-secondary">{result.content}</p></div>
                })}</div>
              </div>
            })}</div>
          </div>}
        </section>

        <div className="flex items-center gap-2 pb-4 text-[11px] text-text-muted"><Check size={13} className="text-accent" />全部数据、索引和评测记录仅保存在当前设备的 Manta 本地服务中。<ArrowRight size={12} />生产检索会返回实际使用的策略版本。</div>
      </main>
    </div>
  )
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return <div className="rounded-xl border border-border bg-surface p-4"><div className="flex items-center gap-2 text-xs text-text-muted">{icon}{label}</div><p className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 truncate text-[11px] text-text-muted">{detail || '—'}</p></div>
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-[11px] text-text-muted">{description}</p></div>{action}</div>
}

function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange: (value: number) => void; min: number }) {
  return <label className="text-xs text-text-muted">{label}<input className={`${fieldClass} mt-1`} type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'ready' || status === 'succeeded' || status === 'published'
    ? 'bg-accent-subtle text-accent'
    : status === 'failed' || status === 'infra_failed' || status === 'invalid_gold'
      ? 'bg-status-failed/10 text-status-failed'
      : status === 'running' || status === 'building' || status === 'in_review'
        ? 'bg-status-running/10 text-status-running'
        : 'bg-border-subtle text-text-muted'
  const label: Record<string, string> = {
    draft: '草稿',
    in_review: '审核中',
    published: '已发布',
    retired: '已停用',
    building: '构建中',
    ready: '已就绪',
    failed: '失败',
    running: '运行中',
    succeeded: '已完成',
    scored: '已评分',
    infra_failed: '基础设施失败',
    invalid_gold: 'Gold 无效',
  }
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}>{label[status] ?? status}</span>
}

function EmptyState({ text }: { text: string }) { return <div className="flex min-h-24 items-center justify-center px-4 py-8 text-center text-xs text-text-muted">{text}</div> }
function chunkerLabel(name: string): string { return name === 'paragraph-v1' ? '自然段落' : name === 'fixed' ? '固定长度' : '递归分块' }
function behaviorLabel(behavior: DatasetCase['expectedBehavior']): string { return behavior === 'answerable' ? '应可回答' : behavior === 'deny' ? '应拒绝' : '应无答案' }
function riskLabel(risk: DatasetCase['risk']): string { return risk === 'critical' ? '关键风险' : risk === 'high' ? '高风险' : '普通风险' }
function statusLabel(status: Dataset['status']): string { return status === 'published' ? '已发布' : status === 'in_review' ? '审核中' : status === 'retired' ? '已停用' : '草稿' }
function forbiddenReasonLabel(reason: ForbiddenReason): string { return reason === 'outdated' ? '过期' : reason === 'unauthorized' ? '无权限' : reason === 'known_wrong' ? '已知错误' : '混淆来源' }
