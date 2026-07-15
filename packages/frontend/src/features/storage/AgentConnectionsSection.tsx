import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentOperationSummary, AgentPlanPreview, AgentStorageProgress } from '@manta/shared'
import { desktopStorageBridge, invokeStorage } from './desktop-storage-bridge'
import { storageApi, type AgentAssets, type AgentConnectionState, type AgentReuseMetrics } from './storage-api'
import { createSubmissionGate } from './submission-gate'

const GROUPS = [{ kind: 'skill', label: 'Skills' }, { kind: 'instructions', label: 'Instructions' }, { kind: 'mcp-server', label: 'MCP servers' }]
const muted = { color: 'var(--color-text-muted)' }

export interface AgentConnectionsViewProps {
  connection: AgentConnectionState
  assets?: AgentAssets
  reuse?: AgentReuseMetrics
  selected: ReadonlySet<string>
  preview?: AgentPlanPreview
  progress?: AgentStorageProgress
  result?: AgentOperationSummary
  error?: Error
  busy: boolean
  onToggle(id: string): void
  onPreviewImport(): void
  onPreviewProjection(): void
  onApply?(): void
  onRollback?(): void
  onRetry?(): void
}

export function AgentConnectionsView(props: AgentConnectionsViewProps) {
  const adapter = props.connection.adapters[0]; const installation = adapter?.installations[0]
  return <section aria-labelledby="agent-connections-heading" style={{ marginTop: 24, borderTop: '1px solid var(--color-border)', paddingTop: 18 }}>
    <h3 id="agent-connections-heading">Agent connections</h3>
    {!adapter ? <p role="status">No supported Agent adapters.</p> : <article style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 14 }}>
      <h4 style={{ marginTop: 0 }}>{adapter.displayName}</h4><p role="status">Status: {props.error ? 'error' : adapter.status}</p>
      {installation && <><p>{installation.displayName}</p><ul>{installation.nativeRoots.map((root) => <li key={root.id}><code>{root.path}</code></li>)}</ul></>}
      {props.assets && <div style={{ display: 'grid', gap: 12 }}>
        <div><strong>Native assets available for import</strong>{GROUPS.map((group) => <div key={`native-${group.kind}`}><h5>{group.label}</h5><ul>{props.assets!.inventory.assets.filter((item) => item.kind === group.kind).map((item) => <li key={item.id}><code>{item.nativePath}</code></li>)}</ul></div>)}</div>
        <div><strong>Portable ASH assets for projection</strong>{GROUPS.map((group) => <fieldset key={`portable-${group.kind}`} style={{ border: 0, padding: 0 }}><legend>{group.label}</legend>{props.assets!.portableAssets.filter((item) => item.kind === group.kind).map((item) => <label key={item.id} style={{ display: 'block' }}><input type="checkbox" checked={props.selected.has(item.id)} disabled={props.busy} onChange={() => props.onToggle(item.id)} /> {item.id}</label>)}</fieldset>)}</div>
        <div><button disabled={props.busy} onClick={props.onPreviewImport}>Preview import</button> <button disabled={props.busy || props.selected.size === 0} onClick={props.onPreviewProjection}>Preview projection</button></div>
      </div>}
      <p role="note" style={muted}>Secret literals stay in ASH Secrets. Projection uses environment-variable names and may require OS setup.</p>
      {props.reuse && <p role="status">Portable assets: {props.reuse.portableAssetCount}. {props.reuse.scanStatus === 'complete' && props.reuse.evidenceStatus === 'verified' && props.reuse.verifiedSavedBytes !== null ? `Savings verified: ${props.reuse.verifiedSavedBytes} bytes` : 'Reuse evidence unavailable.'}</p>}
      {props.preview && <div role="dialog" aria-label="Agent operation preview" style={{ marginTop: 12 }}><h5>Preview {props.preview.kind}</h5><p>Backups are verified before native changes. A committed projection can be rolled back.</p><table><thead><tr><th>Operation</th><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>{props.preview.operations.map((operation) => <tr key={operation.id}><td>{operation.kind}</td><td><code>{operation.nativePath}</code></td><td>{operation.expectedBeforeSha256 ?? 'Absent'}</td><td>{operation.expectedAfterSha256 ?? 'Unchanged'}</td></tr>)}</tbody></table>{props.onApply && <button disabled={props.busy} onClick={props.onApply}>Apply approved plan</button>}</div>}
      {props.progress && <p role="status">{props.progress.phase}: {props.progress.operationsCompleted}/{props.progress.operationsTotal}</p>}
      {props.result && <div role="status">Operation {props.result.status} and {props.result.verified ? 'verified' : 'unverified'}.{props.result.kind === 'projection' && props.result.status === 'committed' && props.onRollback && <button disabled={props.busy} onClick={props.onRollback}>Rollback projection</button>}</div>}
      {props.error && <p role="alert">{props.error.message} {props.onRetry && <button disabled={props.busy} onClick={props.onRetry}>Retry</button>}</p>}
    </article>}
  </section>
}

export function AgentConnectionsSection() {
  const [connection, setConnection] = useState<AgentConnectionState>({ adapters: [{ id: 'codex', displayName: 'Codex', status: 'not-detected', installations: [] }], operations: [] }); const [assets, setAssets] = useState<AgentAssets>(); const [reuse, setReuse] = useState<AgentReuseMetrics>(); const [selected, setSelected] = useState<Set<string>>(new Set()); const [preview, setPreview] = useState<AgentPlanPreview>(); const [progress, setProgress] = useState<AgentStorageProgress>(); const [result, setResult] = useState<AgentOperationSummary>(); const [error, setError] = useState<Error>(); const [busy, setBusy] = useState(false); const gate = useMemo(() => createSubmissionGate(setBusy), [])
  const refresh = useCallback(async () => { setError(undefined); setAssets(undefined); setReuse(undefined); setSelected(new Set()); try { const state = await storageApi.agents(); setConnection(state); const installation = state.adapters[0]?.installations[0]; if (installation) { const [inventory, metrics] = await Promise.all([storageApi.agentAssets(state.adapters[0]!.id, installation.id), storageApi.agentReuse()]); setAssets(inventory); setReuse(metrics) } } catch (reason) { setConnection({ adapters: [{ id: 'codex', displayName: 'Codex', status: 'not-detected', installations: [] }], operations: [] }); setError(reason as Error) } }, [])
  useEffect(() => { void refresh(); return desktopStorageBridge()?.subscribeAgentProgress?.(setProgress) }, [refresh])
  const run = (operation: () => Promise<void>) => gate.run(async () => { setError(undefined); try { await operation() } catch (reason) { setError(reason as Error) } })
  const adapter = connection.adapters[0]; const installation = adapter?.installations[0]
  const plan = (kind: 'import' | 'projection') => run(async () => { if (!adapter || !installation) return; setProgress(undefined); const response = await invokeStorage(kind === 'import' ? { channel: 'storage:agent-plan-import', adapterId: adapter.id, installationId: installation.id } : { channel: 'storage:agent-plan-projection', adapterId: adapter.id, installationId: installation.id, assetIds: [...selected] }); if (response.kind !== 'agent-plan') throw new Error('Agent preview was unavailable'); setPreview(response.plan); setResult(undefined) })
  return <AgentConnectionsView connection={connection} assets={assets} reuse={reuse} selected={selected} preview={preview} progress={progress} result={result} error={error} busy={busy} onToggle={(id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })} onPreviewImport={() => void plan('import')} onPreviewProjection={() => void plan('projection')} onApply={preview ? () => void run(async () => { setProgress(undefined); const response = await invokeStorage({ channel: 'storage:agent-apply', planSessionId: preview.planSessionId }); if (response.kind !== 'agent-applied') throw new Error('Agent apply was unavailable'); setResult(response.result); setPreview(undefined); await refresh() }) : undefined} onRollback={result?.kind === 'projection' && result.status === 'committed' ? () => void run(async () => { setProgress(undefined); const response = await invokeStorage({ channel: 'storage:agent-rollback', operationId: result.operationId }); if (response.kind !== 'agent-rolled-back') throw new Error('Agent rollback was unavailable'); setResult(response.result); await refresh() }) : undefined} onRetry={() => void run(refresh)} />
}
