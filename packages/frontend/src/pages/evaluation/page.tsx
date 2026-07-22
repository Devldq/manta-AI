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
type DocumentInfo = { id: string; name: string; status: string }
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
  knowledgeBaseId: string
  name: string
  queries: Array<{ id: string; query: string; relevantSources: Array<{ documentId: string; quote: string }> }>
}
type Metrics = {
  recallAtK: number
  mrr: number
  ndcgAtK: number
  zeroResultRate: number
  latencyP50Ms: number
  latencyP95Ms: number
}
type EvaluationRun = {
  id: string
  datasetId: string
  strategyVersionId: string
  status: 'running' | 'succeeded' | 'failed'
  metrics?: Metrics
  queries: Array<{
    queryId: string
    query: string
    latencyMs: number
    recall: number
    reciprocalRank: number
    ndcg: number
    retrieved: Array<{ documentId: string; content: string; score: number; relevant: boolean }>
  }>
  createdAt: string
  completedAt?: string
  error?: string
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

function percent(value: number | undefined): string { return value === undefined ? '—' : `${(value * 100).toFixed(1)}%` }
function latency(value: number | undefined): string { return value === undefined ? '—' : `${Math.round(value)} ms` }
function shortId(id: string): string { return id.slice(0, 8) }

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
  const [documentId, setDocumentId] = useState('')
  const [quote, setQuote] = useState('')
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

  function addDraftQuery() {
    if (!query.trim() || !documentId || !quote.trim()) return setError('查询、相关文档和原文依据都必须填写')
    setDraftQueries((current) => [...current, {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
      query: query.trim(), relevantSources: [{ documentId, quote: quote.trim() }],
    }])
    setQuery(''); setQuote('')
  }

  async function createDataset() {
    if (!datasetName.trim() || !draftQueries.length) return setError('评测集名称和至少一条查询是必填项')
    setBusy('create-dataset')
    try {
      const created = await api<Dataset>('/v1/evaluation-datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ knowledgeBaseId, name: datasetName.trim(), queries: draftQueries }),
      })
      setDatasetName(''); setDraftQueries([]); setShowDatasetForm(false)
      await loadLab(knowledgeBaseId); setDatasetId(created.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  async function runEvaluation() {
    if (!datasetId || !selectedStrategies.length) return setError('请选择评测集和至少一个已就绪策略')
    setBusy('run-evaluation')
    try {
      const submitted = await api<Array<{ run: EvaluationRun; job: Job }>>('/v1/evaluations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId, strategyVersionIds: selectedStrategies }),
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
                <div className="text-xs"><StatusBadge status={strategy.status} /><p className="mt-1 text-text-muted">Recall {percent(strategy.evaluationSummary?.recallAtK)}</p></div>
                <div className="flex justify-end gap-2">{strategy.status !== 'ready' ? <button className={buttonClass} disabled={Boolean(busy)} onClick={() => void buildStrategy(strategy)}>{busy === `build:${strategy.id}` ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}构建</button> : <button className={buttonClass} disabled={active || Boolean(busy)} onClick={() => void activateStrategy(strategy)}>{active ? <Check size={14} /> : <RotateCcw size={14} />}{active ? '已激活' : '激活'}</button>}</div>
                {strategy.error && <p className="text-xs text-status-failed md:col-start-2 md:col-span-5">{strategy.error}</p>}
              </div>
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <SectionHeader title="人工评测集" description="Ground Truth 绑定文档与原文片段，不依赖会随策略改变的 Chunk ID。" action={<button className={buttonClass} onClick={() => setShowDatasetForm((value) => !value)} disabled={!knowledgeBaseId}><Plus size={14} />新建评测集</button>} />
          {showDatasetForm && <div className="space-y-3 border-b border-border bg-border-subtle/35 p-4">
            <label className="block max-w-xl text-xs text-text-muted">评测集名称<input className={`${fieldClass} mt-1`} value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="例如：Manta 核心能力问答" /></label>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_260px_1fr_auto]">
              <label className="text-xs text-text-muted">测试查询<input className={`${fieldClass} mt-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户会怎样提问？" /></label>
              <label className="text-xs text-text-muted">相关文档<select className={`${fieldClass} mt-1`} value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">选择已入库文档</option>{documents.filter((document) => document.status === 'ready').map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
              <label className="text-xs text-text-muted">原文依据<input className={`${fieldClass} mt-1`} value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="粘贴应当被召回的原文片段" /></label>
              <button className={`${buttonClass} self-end`} onClick={addDraftQuery}><Plus size={14} />加入</button>
            </div>
            {draftQueries.length > 0 && <div className="divide-y divide-border rounded-lg border border-border bg-surface">{draftQueries.map((item, index) => <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs"><div><p className="font-medium">{index + 1}. {item.query}</p><p className="mt-1 line-clamp-1 text-text-muted">{item.relevantSources[0].quote}</p></div><button className="text-text-muted hover:text-status-failed" onClick={() => setDraftQueries((current) => current.filter((queryItem) => queryItem.id !== item.id))}><X size={14} /></button></div>)}</div>}
            <div className="flex gap-2"><button className={primaryButtonClass} onClick={() => void createDataset()} disabled={busy === 'create-dataset'}>保存评测集</button><button className={buttonClass} onClick={() => setShowDatasetForm(false)}>取消</button></div>
          </div>}
          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
            <label className="min-w-64 flex-1 text-xs text-text-muted">当前评测集<select className={`${fieldClass} mt-1`} value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="">选择评测集</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.queries.length} queries</option>)}</select></label>
            <div className="flex-1 text-xs text-text-muted"><p>待比较策略</p><p className="mt-2 text-sm text-text-secondary">{selectedStrategies.length ? selectedStrategies.map((id) => `v${strategies.find((strategy) => strategy.id === id)?.version}`).join('、') : '在上方勾选已就绪策略'}</p></div>
            <button className={primaryButtonClass} disabled={!datasetId || !selectedStrategies.length || Boolean(busy)} onClick={() => void runEvaluation()}>{busy === 'run-evaluation' ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}运行对比评测</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <SectionHeader title="评测结果" description="指标和逐 Query 召回内容都会保存在本地，可以重新打开比较。" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-border bg-border-subtle/50 text-text-muted"><tr><th className="w-10 px-4 py-2.5"></th><th className="px-3 py-2.5 font-medium">策略</th><th className="px-3 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">Recall@K</th><th className="px-3 py-2.5 font-medium">MRR</th><th className="px-3 py-2.5 font-medium">nDCG@K</th><th className="px-3 py-2.5 font-medium">零结果率</th><th className="px-3 py-2.5 font-medium">P50</th><th className="px-3 py-2.5 font-medium">P95</th><th className="px-3 py-2.5 font-medium">运行时间</th></tr></thead>
              <tbody className="divide-y divide-border">{runs.map((run) => {
                const strategy = strategies.find((item) => item.id === run.strategyVersionId)
                const expanded = run.id === expandedRunId
                return <tr key={run.id} className="cursor-pointer hover:bg-border-subtle/35" onClick={() => setExpandedRunId(expanded ? undefined : run.id)}><td className="px-4 py-3 text-text-muted">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td><td className="px-3 py-3"><p className="font-medium">{strategy?.name ?? shortId(run.strategyVersionId)}</p><p className="mt-1 font-mono text-[10px] text-text-muted">{strategy ? `v${strategy.version}` : shortId(run.strategyVersionId)}</p></td><td className="px-3 py-3"><StatusBadge status={run.status} /></td><td className="px-3 py-3 font-mono">{percent(run.metrics?.recallAtK)}</td><td className="px-3 py-3 font-mono">{percent(run.metrics?.mrr)}</td><td className="px-3 py-3 font-mono">{percent(run.metrics?.ndcgAtK)}</td><td className="px-3 py-3 font-mono">{percent(run.metrics?.zeroResultRate)}</td><td className="px-3 py-3 font-mono">{latency(run.metrics?.latencyP50Ms)}</td><td className="px-3 py-3 font-mono">{latency(run.metrics?.latencyP95Ms)}</td><td className="px-3 py-3 text-text-muted">{new Date(run.createdAt).toLocaleString()}</td></tr>
              })}</tbody>
            </table>
            {!runs.length && <EmptyState text={datasetId ? '这个评测集还没有运行记录。' : '选择一个评测集查看可复现的历史结果。'} />}
          </div>
          {expandedRun && <div className="border-t border-border bg-border-subtle/25 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">逐 Query 召回</h3><span className="font-mono text-[10px] text-text-muted">run {shortId(expandedRun.id)}</span></div><div className="space-y-3">{expandedRun.queries.map((item) => <div key={item.queryId} className="rounded-lg border border-border bg-surface p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{item.query}</p><p className="text-[11px] text-text-muted">Recall {percent(item.recall)} · RR {item.reciprocalRank.toFixed(2)} · nDCG {item.ndcg.toFixed(2)} · {latency(item.latencyMs)}</p></div><div className="mt-3 space-y-2">{item.retrieved.map((result, index) => <div key={`${result.documentId}-${index}`} className={`rounded-md border px-3 py-2 text-xs ${result.relevant ? 'border-accent/35 bg-accent-subtle/45' : 'border-border bg-background'}`}><div className="mb-1 flex items-center justify-between gap-2"><span className="font-mono text-[10px] text-text-muted">#{index + 1} · {shortId(result.documentId)}</span><span className={result.relevant ? 'text-accent' : 'text-text-muted'}>{result.relevant ? '相关' : '未命中'} · {result.score.toFixed(3)}</span></div><p className="line-clamp-3 leading-5 text-text-secondary">{result.content}</p></div>)}</div></div>)}</div></div>}
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
  const style = status === 'ready' || status === 'succeeded' ? 'bg-accent-subtle text-accent' : status === 'failed' ? 'bg-status-failed/10 text-status-failed' : status === 'running' || status === 'building' ? 'bg-status-running/10 text-status-running' : 'bg-border-subtle text-text-muted'
  const label: Record<string, string> = { draft: '草稿', building: '构建中', ready: '已就绪', failed: '失败', running: '运行中', succeeded: '已完成' }
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}>{label[status] ?? status}</span>
}

function EmptyState({ text }: { text: string }) { return <div className="flex min-h-24 items-center justify-center px-4 py-8 text-center text-xs text-text-muted">{text}</div> }
function chunkerLabel(name: string): string { return name === 'paragraph-v1' ? '自然段落' : name === 'fixed' ? '固定长度' : '递归分块' }
