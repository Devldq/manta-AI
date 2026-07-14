import { useState } from 'react'
import { GitRemoteUrlSchema, type StorageGitImportPlan, type StorageIpcRequest, type StorageVolumeCapacityMetrics, type StorageVolumeRecord } from '@manta/shared'

type GitBinding = { volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; lastSyncedAt?: string; lastSyncStatus?: 'succeeded'; createdAt: string; updatedAt: string }
type ImportDecisions = Extract<StorageIpcRequest, { channel: 'storage:apply-git-import' }>['decisions']
type VolumeHealth = { status: 'healthy' | 'offline' | 'unreadable' | 'conflict'; conflicts: string[]; checkedAt: string; reason?: string }

export function StorageVolumeCard({ volume, bytes = 0, files = 0, capacity, onRelocate, onOpen, disabled, git, health, onConfigureGit, onSync, onPlanImport, onApplyImport }: { volume: StorageVolumeRecord; bytes?: number; files?: number; capacity?: StorageVolumeCapacityMetrics; onRelocate: () => void; onOpen: () => void; disabled: boolean; git?: { available: boolean; reason?: string; binding?: GitBinding }; health?: VolumeHealth; onConfigureGit?: (request: Extract<StorageIpcRequest, { channel: 'storage:configure-git' }>) => Promise<void> | void; onSync?: () => Promise<void> | void; onPlanImport?: () => Promise<StorageGitImportPlan>; onApplyImport?: (plan: StorageGitImportPlan, decisions: ImportDecisions) => Promise<void> }) {
  const [remoteUrl, setRemoteUrl] = useState(git?.binding?.remoteUrl ?? '')
  const [gitError, setGitError] = useState<string>()
  const [gitLoading, setGitLoading] = useState(false)
  const [importPlan, setImportPlan] = useState<StorageGitImportPlan>()
  const [importChoices, setImportChoices] = useState<Record<string, string>>({})
  const configure = async (mode: 'local' | 'remote') => {
    if (!onConfigureGit) return
    if (mode === 'remote' && !GitRemoteUrlSchema.safeParse(remoteUrl).success) { setGitError('Enter a credential-free HTTPS, HTTP, or SSH Git remote URL.'); return }
    if (typeof window !== 'undefined' && !window.confirm(`Configure ${mode} Git for ${volume.name}? This never stores a password or token.`)) return
    setGitLoading(true); setGitError(undefined)
    try { await onConfigureGit(mode === 'local' ? { channel: 'storage:configure-git', volumeId: volume.id, mode } : { channel: 'storage:configure-git', volumeId: volume.id, mode, remoteUrl }) }
    catch (error) { setGitError((error as Error).message) } finally { setGitLoading(false) }
  }
  return <article aria-label={`${volume.name} volume`} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
    <strong>{volume.name}</strong><div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{volume.parentPath}/.manta-ai</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0' }}>{bytes} bytes · {files} files</div>
    {capacity && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0' }}>Immutable {capacity.logicalImmutableBytes === null ? 'logical unavailable' : `${capacity.logicalImmutableBytes} B logical`} / {capacity.physicalImmutableBytes === null ? 'physical unavailable' : `${capacity.physicalImmutableBytes} B physical`} · Replica/cache {capacity.replicaBytes === null ? 'unavailable' : `${capacity.replicaBytes} B`} · Cleanable {capacity.cleanableBytes === null ? 'unavailable' : `${capacity.cleanableBytes} B`}</div>}
    <button disabled={disabled} onClick={onOpen}>Open</button> <button disabled={disabled} onClick={onRelocate}>Migrate volume</button>
    {health && health.status !== 'healthy' && <div role="alert" style={{ marginTop: 8 }}>Automatic sync paused: this folder is {health.status}.{health.reason ? ` (${health.reason})` : ''}{health.conflicts.length ? ` Conflicts: ${health.conflicts.join(', ')}` : ''}</div>}
    <section aria-label={`${volume.name} Git sync`} style={{ marginTop: 10, fontSize: 12 }}>
      <div>Git: {git?.binding ? git.binding.mode : git?.available ? 'not configured' : 'unavailable'}</div>
      {git?.binding?.remoteUrl && <div style={{ overflowWrap: 'anywhere' }}>{git.binding.remoteUrl}</div>}
      {git?.binding?.lastSyncedAt && <div role="status">Last sync {git.binding.lastSyncStatus ?? 'succeeded'}: {new Date(git.binding.lastSyncedAt).toLocaleString()}</div>}
      {git?.binding && <div role="status">This volume is already bound to {git.binding.mode} Git. To use a different repository, create another storage volume.</div>}
      {git?.binding && onSync && <button disabled={disabled || gitLoading} onClick={() => { setGitLoading(true); setGitError(undefined); void Promise.resolve(onSync()).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false)) }}>Sync now</button>}
      {git?.binding?.mode === 'remote' && onPlanImport && <button disabled={disabled || gitLoading} onClick={() => {
        setGitLoading(true); setGitError(undefined)
        void onPlanImport().then((plan) => {
          setImportPlan(plan)
          setImportChoices(Object.fromEntries(plan.groups.map((group) => [group.group, group.defaultChoice])))
        }).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false))
      }}>Check remote updates</button>}
      {importPlan && <section aria-label={`${volume.name} remote import plan`} style={{ marginTop: 8, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
        <strong>Remote changes</strong>
        {importPlan.groups.map((group) => <div key={group.group} style={{ marginTop: 5 }}><label>{group.group}: {group.state} <select aria-label={`${group.group} import choice`} value={importChoices[group.group] ?? group.defaultChoice} onChange={(event) => setImportChoices((choices) => ({ ...choices, [group.group]: event.target.value }))}>{group.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label></div>)}
        <p role="status">Remote data stays in an isolated cache until you apply these choices. Database groups are never merged.</p>
        {onApplyImport && <button disabled={disabled || gitLoading} onClick={() => { setGitLoading(true); setGitError(undefined); void onApplyImport(importPlan, importChoices as ImportDecisions).then(() => setImportPlan(undefined)).catch((error) => setGitError((error as Error).message)).finally(() => setGitLoading(false)) }}>Apply selected remote changes</button>}
      </section>}
      {git?.reason && <div role="status">{git.reason}</div>}
      {git?.available && onConfigureGit && <><button disabled={disabled || gitLoading} onClick={() => void configure('local')}>Configure local Git</button><div><label>Remote URL <input aria-label={`${volume.name} Git remote URL`} value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://host/owner/repository.git" /></label><button disabled={disabled || gitLoading} onClick={() => void configure('remote')}>Configure remote Git</button></div></>}
      {git?.available && <div role="status">Credential references are not supported in this build. For authenticated remotes, configure your system Git credential helper.</div>}
      {gitLoading && <div role="status">Configuring Git…</div>}{gitError && <div role="alert">{gitError}</div>}
    </section>
  </article>
}
