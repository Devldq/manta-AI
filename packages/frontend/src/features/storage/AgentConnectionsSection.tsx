import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AgentOperationReadSummary, AgentOperationSummary, AgentPlanPreview, AgentStorageProgress } from '@manta/shared'
import { ChevronDown } from 'lucide-react'
import { desktopStorageBridge, invokeStorage } from './desktop-storage-bridge'
import { storageApi, type AgentAssets, type AgentConnectionState, type AgentReuseMetrics } from './storage-api'
import { createSubmissionGate } from './submission-gate'
import { StorageSection, StorageStatusBadge } from './StoragePrimitives'
import { formatStorageBytes, humanizeStorageState } from './storage-ui'

const GROUPS = [
  { kind: 'skill', label: 'Skills' },
  { kind: 'instructions', label: 'Instructions' },
  { kind: 'mcp-server', label: 'MCP servers' },
]

function restoreDurableAgentOperation(operations: AgentOperationReadSummary[]): {
  active?: AgentOperationReadSummary
  result?: AgentOperationSummary
} {
  const latestFirst = [...operations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.operationId.localeCompare(left.operationId))
  const active = latestFirst.find((operation) => operation.status === 'running' || operation.status === 'recovering')
  if (active) return { active }
  const terminal = latestFirst.find((operation) => operation.status === 'committed' || operation.status === 'rolled-back')
  if (!terminal || (terminal.phase !== 'committed' && terminal.phase !== 'rolled-back')) return {}
  return {
    result: {
      operationId: terminal.operationId,
      adapterId: terminal.adapterId,
      installationId: terminal.installationId,
      kind: terminal.kind,
      phase: terminal.phase,
      status: terminal.phase,
      verified: terminal.verified,
      completedAt: terminal.updatedAt,
      operationCount: terminal.operationCount,
      ...(terminal.materializationStrategies ? { materializationStrategies: terminal.materializationStrategies } : {}),
    },
  }
}

export interface AgentConnectionsViewProps {
  connection: AgentConnectionState
  loading?: boolean
  assets?: AgentAssets
  reuse?: AgentReuseMetrics
  nativeSelected: ReadonlySet<string>
  portableSelected: ReadonlySet<string>
  preview?: AgentPlanPreview
  progress?: AgentStorageProgress
  result?: AgentOperationSummary
  error?: Error
  busy: boolean
  onToggleNative(id: string): void
  onTogglePortable(id: string): void
  onPreviewImport(): void
  onPreviewProjection(): void
  onApply?(): void
  onRollback?(operationId: string): void
  onRetry?(): void
}

export function AgentConnectionsView(props: AgentConnectionsViewProps) {
  const previewTitleId = `storage-agent-preview-${useId()}`
  const adapter = props.connection.adapters[0]
  const installation = adapter?.installations[0]
  const adapterStatus = props.error ? 'error' : adapter?.status ?? 'not-detected'
  const nativeAssets = props.assets?.inventory.assets ?? []
  const portableAssets = props.assets?.portableAssets ?? []
  const restoredOperation = restoreDurableAgentOperation(props.connection.operations)
  const activeOperation = restoredOperation.active
  const visibleResult = activeOperation ? undefined : props.result ?? (!props.preview ? restoredOperation.result : undefined)
  const busy = props.busy || !!activeOperation
  const [detailsOpen, setDetailsOpen] = useState(!!props.preview)
  const detailsSummaryRef = useRef<HTMLElement>(null)
  const restoreActionFocusRef = useRef<'apply' | 'rollback' | undefined>(undefined)

  useEffect(() => {
    if (props.preview) setDetailsOpen(true)
  }, [props.preview])

  useEffect(() => {
    if (!restoreActionFocusRef.current || busy) return
    const originatingActionAvailable = restoreActionFocusRef.current === 'apply'
      ? !!props.preview && !!props.onApply
      : visibleResult?.kind === 'projection'
      && visibleResult.status === 'committed'
      && !!props.onRollback
    if (originatingActionAvailable) return
    restoreActionFocusRef.current = undefined
    queueMicrotask(() => detailsSummaryRef.current?.focus())
  }, [busy, props.onApply, props.onRollback, props.preview, visibleResult])

  return <StorageSection title="Agent connections" description="Import native Agent assets into ASH or project portable assets back to the Agent.">
    {props.loading ? <div className="storage-agent__loading" role="status" aria-busy="true">
      <StorageStatusBadge value="scanning" />
      <strong>Scanning Agent connections</strong>
      <span>Detecting installations and portable assets…</span>
    </div> : props.error && !adapter ? <div className="storage-alert storage-alert--danger storage-agent__error" role="alert">
      <StorageStatusBadge value="error" />
      <span>{props.error.message}</span>
      {props.onRetry && <button type="button" className="storage-button" disabled={busy} onClick={props.onRetry}>Retry</button>}
    </div> : !adapter ? <div className="storage-empty" role="status">
      <strong>No supported Agent adapters</strong>
      <p>Install or configure a supported Agent to manage its portable assets here.</p>
    </div> : <article className="storage-agent">
      <header className="storage-agent__header">
        <div>
          <h4>{adapter.displayName}</h4>
          {installation && installation.displayName !== adapter.displayName && <p>{installation.displayName}</p>}
          <span className="storage-agent__counts">{nativeAssets.length} native · {portableAssets.length} portable</span>
        </div>
        <div className="storage-agent__status" role="status" aria-label={`Status: ${adapterStatus}`}>
          <StorageStatusBadge value={adapterStatus} />
        </div>
      </header>

      {(installation || props.assets) && <details className="storage-agent__details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary ref={detailsSummaryRef}>
          <span>Assets and locations</span>
          <span>{detailsOpen ? 'Hide details' : 'View details'}<ChevronDown className="storage-agent__details-chevron" size={14} aria-hidden="true" /></span>
        </summary>
        <div className="storage-agent__details-body">
          {installation && <div className="storage-agent__roots">
            <span>Native locations</span>
            {installation.nativeRoots.length > 0
              ? <ul>{installation.nativeRoots.map((root) => <li key={root.id}><code>{root.path}</code></li>)}</ul>
              : <p>No native locations detected.</p>}
          </div>}
          {props.assets && <div className="storage-agent__assets">
            <div className="storage-agent__asset-column">
              <strong>Native assets available for import</strong>
              {GROUPS.map((group) => {
                const items = nativeAssets.filter((item) => item.kind === group.kind)
                return items.length > 0 ? <fieldset className="storage-fieldset" key={`native-${group.kind}`}>
                  <legend>{group.label}</legend>
                  {items.map((item) => <label className="storage-agent__checkbox" key={item.id}>
                    <input className="storage-control storage-agent__checkbox-input" type="checkbox" checked={props.nativeSelected.has(item.id)} disabled={busy} onChange={() => props.onToggleNative(item.id)} />
                    <code>{item.nativePath}</code>
                  </label>)}
                </fieldset> : null
              })}
              {nativeAssets.length === 0 && <p className="storage-agent__column-empty">No native assets found.</p>}
            </div>
            <div className="storage-agent__asset-column">
              <strong>Portable ASH assets for projection</strong>
              {GROUPS.map((group) => {
                const items = portableAssets.filter((item) => item.kind === group.kind)
                return items.length > 0 ? <fieldset className="storage-fieldset" key={`portable-${group.kind}`}>
                  <legend>{group.label}</legend>
                  {items.map((item) => <label className="storage-agent__checkbox" key={item.id}>
                    <input className="storage-control storage-agent__checkbox-input" type="checkbox" checked={props.portableSelected.has(item.id)} disabled={busy} onChange={() => props.onTogglePortable(item.id)} />
                    <span>{item.id}</span>
                  </label>)}
                </fieldset> : null
              })}
              {portableAssets.length === 0 && <p className="storage-agent__column-empty">No portable assets found.</p>}
            </div>
            <div className="storage-agent__asset-actions storage-actions">
              <button type="button" className="storage-button" disabled={busy || props.nativeSelected.size === 0} onClick={props.onPreviewImport}>Preview import</button>
              <button type="button" className="storage-button" disabled={busy || props.portableSelected.size === 0} onClick={props.onPreviewProjection}>Preview projection</button>
            </div>
          </div>}
          <p className="storage-alert" role="note">Secret literals stay in ASH Secrets. Projection uses environment-variable names and may require OS setup.</p>
          {props.reuse && <div className="storage-agent__reuse" role="status">
            <span>Portable assets: {props.reuse.portableAssetCount}</span>
            <strong>{props.reuse.scanStatus === 'complete' && props.reuse.evidenceStatus === 'verified' && props.reuse.verifiedSavedBytes !== null ? `Savings verified: ${formatStorageBytes(props.reuse.verifiedSavedBytes)}` : 'Reuse evidence unavailable.'}</strong>
          </div>}
        </div>
      </details>}

      {props.preview && <section className="storage-agent__preview" role="region" aria-labelledby={previewTitleId}>
        <header><h5 id={previewTitleId}>Preview {props.preview.kind}</h5><StorageStatusBadge value="warning" /></header>
        <p>Backups are verified before native changes. A committed projection can be rolled back.</p>
        <div className="storage-table-wrap"><table className="storage-table">
          <thead><tr><th scope="col">Operation</th><th scope="col">Path</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
          <tbody>{props.preview.operations.map((operation) => <tr key={operation.id}>
            <td>{operation.kind}</td>
            <td><code>{operation.nativePath}</code></td>
            <td>{operation.expectedBeforeSha256 ? <code>{operation.expectedBeforeSha256}</code> : 'Absent'}</td>
            <td>{operation.expectedAfterSha256 ? <code>{operation.expectedAfterSha256}</code> : 'Unchanged'}</td>
          </tr>)}</tbody>
        </table></div>
        {props.onApply && <button type="button" className="storage-button storage-button--primary" disabled={busy} onClick={() => { restoreActionFocusRef.current = 'apply'; props.onApply?.() }}>Apply approved plan</button>}
      </section>}
      {props.progress && <div className="storage-agent__state" role="status">
        <StorageStatusBadge value={props.progress.phase} />
        <span>{humanizeStorageState(props.progress.phase)}: {props.progress.operationsCompleted}/{props.progress.operationsTotal}</span>
      </div>}
      {!props.progress && activeOperation && <div className="storage-agent__state" role="status">
        <StorageStatusBadge value={activeOperation.phase} />
        <span>{humanizeStorageState(activeOperation.phase)}: {activeOperation.operationCount} planned {activeOperation.operationCount === 1 ? 'change' : 'changes'}</span>
      </div>}
      {visibleResult && <div className="storage-agent__state" role="status">
        <StorageStatusBadge value={visibleResult.status} />
        <span>Operation {humanizeStorageState(visibleResult.status).toLowerCase()} and {visibleResult.verified ? 'verified' : 'unverified'}.</span>
        {visibleResult.kind === 'projection' && visibleResult.status === 'committed' && props.onRollback && <button type="button" className="storage-button" disabled={busy} onClick={() => { restoreActionFocusRef.current = 'rollback'; props.onRollback?.(visibleResult.operationId) }}>Rollback projection</button>}
      </div>}
      {props.error && <div className="storage-alert storage-alert--danger storage-agent__error" role="alert">
        <StorageStatusBadge value="error" />
        <span>{props.error.message}</span>
        {props.onRetry && <button type="button" className="storage-button" disabled={busy} onClick={props.onRetry}>Retry</button>}
      </div>}
    </article>}
  </StorageSection>
}

export function AgentConnectionsSection() {
  const [connection, setConnection] = useState<AgentConnectionState>({ adapters: [], operations: [] })
  const [loading, setLoading] = useState(true)
  const [assets, setAssets] = useState<AgentAssets>()
  const [reuse, setReuse] = useState<AgentReuseMetrics>()
  const [nativeSelected, setNativeSelected] = useState<Set<string>>(new Set())
  const [portableSelected, setPortableSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<AgentPlanPreview>()
  const [progress, setProgress] = useState<AgentStorageProgress>()
  const [result, setResult] = useState<AgentOperationSummary>()
  const [error, setError] = useState<Error>()
  const [busy, setBusy] = useState(false)
  const gate = useMemo(() => createSubmissionGate(setBusy), [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const state = await storageApi.agents()
      const adapter = state.adapters[0]
      const installation = adapter?.installations[0]
      const loaded = adapter && installation
        ? await Promise.all([storageApi.agentAssets(adapter.id, installation.id), storageApi.agentReuse()])
        : undefined
      setConnection(state)
      setAssets(loaded?.[0])
      setReuse(loaded?.[1])
      setNativeSelected(new Set())
      setPortableSelected(new Set())
      setError(undefined)
    } catch (reason) {
      setError(reason as Error)
      throw reason
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh().catch(() => {})
    return desktopStorageBridge()?.subscribeAgentProgress?.((next) => {
      setProgress(next)
      if (next.status !== 'running') void refresh().then(() => setProgress(undefined)).catch(() => {})
    })
  }, [refresh])

  const run = (operation: () => Promise<void>) => gate.run(async () => {
    try {
      await operation()
      setError(undefined)
    } catch (reason) {
      setError(reason as Error)
    }
  })
  const adapter = connection.adapters[0]
  const installation = adapter?.installations[0]
  const plan = (kind: 'import' | 'projection') => run(async () => {
    if (!adapter || !installation) return
    setProgress(undefined)
    const response = await invokeStorage(kind === 'import'
      ? { channel: 'storage:agent-plan-import', adapterId: adapter.id, installationId: installation.id, assetIds: [...nativeSelected] }
      : { channel: 'storage:agent-plan-projection', adapterId: adapter.id, installationId: installation.id, assetIds: [...portableSelected] })
    if (response.kind !== 'agent-plan') throw new Error('Agent preview was unavailable')
    setPreview(response.plan)
    setResult(undefined)
  })
  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>) => (id: string) => setter((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <AgentConnectionsView
    connection={connection}
    loading={loading}
    assets={assets}
    reuse={reuse}
    nativeSelected={nativeSelected}
    portableSelected={portableSelected}
    preview={preview}
    progress={progress}
    result={result}
    error={error}
    busy={busy}
    onToggleNative={toggle(setNativeSelected)}
    onTogglePortable={toggle(setPortableSelected)}
    onPreviewImport={() => void plan('import')}
    onPreviewProjection={() => void plan('projection')}
    onApply={preview ? () => void run(async () => {
      setProgress(undefined)
      const response = await invokeStorage({ channel: 'storage:agent-apply', planSessionId: preview.planSessionId })
      if (response.kind !== 'agent-applied') throw new Error('Agent apply was unavailable')
      setResult(response.result)
      setPreview(undefined)
      await refresh()
    }) : undefined}
    onRollback={(operationId) => void run(async () => {
      setProgress(undefined)
      const response = await invokeStorage({ channel: 'storage:agent-rollback', operationId })
      if (response.kind !== 'agent-rolled-back') throw new Error('Agent rollback was unavailable')
      setResult(response.result)
      await refresh()
    })}
    onRetry={() => void run(refresh)}
  />
}
