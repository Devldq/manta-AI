import { useId, useLayoutEffect, useRef, useState } from 'react'
import {
  ASH_VOLUME_DIR_NAME,
  GitRemoteUrlSchema,
  type StorageGitImportPlan,
  type StorageIpcRequest,
  type StorageVolumeCapacityMetrics,
  type StorageVolumeRecord,
} from '@manta/shared'

import { StorageStatusBadge } from './StoragePrimitives'
import { formatFileCount, formatStorageBytes } from './storage-ui'

type GitBinding = {
  volumeId: string
  mode: 'local' | 'remote'
  remoteUrl?: string
  credentialRef?: string
  includeSecrets?: boolean
  lastSyncedAt?: string
  lastSyncStatus?: 'succeeded'
  createdAt: string
  updatedAt: string
}

type ImportDecisions = Extract<
  StorageIpcRequest,
  { channel: 'storage:apply-git-import' }
>['decisions']

type VolumeHealth = {
  status: 'healthy' | 'offline' | 'unreadable' | 'conflict'
  conflicts: string[]
  checkedAt: string
  reason?: string
}

interface StorageVolumeCardProps {
  volume: StorageVolumeRecord
  bytes?: number
  files?: number
  capacity?: StorageVolumeCapacityMetrics
  showCapacityBreakdown?: boolean
  onRelocate: () => void
  onOpen: () => void
  disabled: boolean
  git?: { available: boolean; reason?: string; binding?: GitBinding }
  health?: VolumeHealth
  onConfigureGit?: (
    request: Extract<StorageIpcRequest, { channel: 'storage:configure-git' }>,
  ) => Promise<void> | void
  onRequestGitSecretsGrant?: () => Promise<string>
  onSetGitSecretsPolicy?: (includeSecrets: boolean, grant?: string) => Promise<void>
  onSync?: () => Promise<void> | void
  onPlanImport?: () => Promise<StorageGitImportPlan>
  onApplyImport?: (plan: StorageGitImportPlan, decisions: ImportDecisions) => Promise<void>
}

function displayVolumeRoot(parentPath: string): string {
  const windows = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(parentPath)
  const separator = windows ? '\\' : '/'
  const parent = windows ? parentPath.replace(/[\\/]+$/, '') : parentPath.replace(/\/+$/, '')
  return `${parent}${separator}${ASH_VOLUME_DIR_NAME}`
}

export function StorageVolumeCard({
  volume,
  bytes,
  files,
  capacity,
  showCapacityBreakdown = true,
  onRelocate,
  onOpen,
  disabled,
  git,
  health,
  onConfigureGit,
  onRequestGitSecretsGrant,
  onSetGitSecretsPolicy,
  onSync,
  onPlanImport,
  onApplyImport,
}: StorageVolumeCardProps) {
  const [remoteUrl, setRemoteUrl] = useState(git?.binding?.remoteUrl ?? '')
  const [remoteUrlError, setRemoteUrlError] = useState<string>()
  const [gitError, setGitError] = useState<string>()
  const [gitLoading, setGitLoading] = useState(false)
  const [gitBusyLabel, setGitBusyLabel] = useState('Working with Git…')
  const [pendingGitMode, setPendingGitMode] = useState<'local' | 'remote'>()
  const [importPlan, setImportPlan] = useState<StorageGitImportPlan>()
  const [importChoices, setImportChoices] = useState<Record<string, string>>({})
  const gitLoadingRef = useRef(false)
  const remoteInputRef = useRef<HTMLInputElement>(null)
  const pendingGitOpenerRef = useRef<HTMLButtonElement>(null)
  const gitConfirmRef = useRef<HTMLButtonElement>(null)
  const gitSummaryRef = useRef<HTMLElement>(null)
  const restoreImportFocusRef = useRef(false)
  const remoteHelpId = `storage-git-remote-help-${useId()}`
  const remoteErrorId = `storage-git-remote-error-${useId()}`
  const volumeRoot = displayVolumeRoot(volume.parentPath)
  const gitState = git?.binding
    ? git.binding.mode
    : git?.available
      ? 'not configured'
      : 'unavailable'
  const formattedFileCount = formatFileCount(files ?? Number.NaN)
  const fileCount = formattedFileCount.replace(/ files?$/, '')
  const fileCountLabel = formattedFileCount.endsWith(' file') ? 'File' : 'Files'

  useLayoutEffect(() => {
    if (pendingGitMode) gitConfirmRef.current?.focus()
  }, [pendingGitMode])

  useLayoutEffect(() => {
    if (!gitLoading && !importPlan && restoreImportFocusRef.current) {
      restoreImportFocusRef.current = false
      gitSummaryRef.current?.focus()
    }
  }, [gitLoading, importPlan])

  const restoreGitFocus = () => {
    const opener = pendingGitOpenerRef.current
    if (opener?.isConnected && !opener.disabled) opener.focus()
    else gitSummaryRef.current?.focus()
    pendingGitOpenerRef.current = null
  }

  const closeGitConfirmation = () => {
    setPendingGitMode(undefined)
    queueMicrotask(restoreGitFocus)
  }

  const runGitAction = async (busyLabel: string, action: () => Promise<void>) => {
    if (gitLoadingRef.current) return false
    gitLoadingRef.current = true
    setGitLoading(true)
    setGitBusyLabel(busyLabel)
    setGitError(undefined)
    try {
      await action()
      return true
    } catch (reason) {
      setGitError((reason as Error).message)
      return false
    } finally {
      gitLoadingRef.current = false
      setGitLoading(false)
    }
  }

  const requestConfigure = (mode: 'local' | 'remote', opener: HTMLButtonElement) => {
    if (!onConfigureGit || gitLoadingRef.current) return
    if (mode === 'remote' && !GitRemoteUrlSchema.safeParse(remoteUrl).success) {
      setRemoteUrlError('Enter a credential-free HTTPS, HTTP, or SSH Git remote URL.')
      remoteInputRef.current?.focus()
      return
    }
    setRemoteUrlError(undefined)
    setGitError(undefined)
    pendingGitOpenerRef.current = opener
    setPendingGitMode(mode)
  }

  const confirmConfigure = async () => {
    const mode = pendingGitMode
    if (!mode || !onConfigureGit) return
    const completed = await runGitAction(`Configuring ${mode} Git…`, async () => {
      await onConfigureGit(
        mode === 'local'
          ? { channel: 'storage:configure-git', volumeId: volume.id, mode }
          : {
              channel: 'storage:configure-git',
              volumeId: volume.id,
              mode,
              remoteUrl,
            },
      )
    })
    if (completed) closeGitConfirmation()
  }

  const setSecretsPolicy = async (includeSecrets: boolean) => {
    if (!onSetGitSecretsPolicy) return
    await runGitAction('Updating secrets policy…', async () => {
      const grant = includeSecrets ? await onRequestGitSecretsGrant?.() : undefined
      if (includeSecrets && !grant) throw new Error('High-risk secrets confirmation was not granted')
      await onSetGitSecretsPolicy(includeSecrets, grant)
    })
  }

  return (
    <article aria-label={`${volume.name} volume`} className="storage-volume">
      <header className="storage-volume__header">
        <div className="storage-volume__identity">
          <div className="storage-volume__title">
            <strong>{volume.name}</strong>
            <StorageStatusBadge value={health?.status ?? 'not-monitored'} />
          </div>
          <code title={volumeRoot} className="storage-volume__path">{volumeRoot}</code>
        </div>
        <div className="storage-actions">
          <button type="button" className="storage-button" disabled={disabled} onClick={onOpen}>Open folder</button>
          <button type="button" className="storage-button" disabled={disabled} onClick={onRelocate}>Migrate</button>
        </div>
      </header>

      <div className={`storage-volume__facts${showCapacityBreakdown ? '' : ' storage-volume__facts--compact'}`}>
        <span><b>{formatStorageBytes(bytes)}</b><small>Stored</small></span>
        <span><b>{fileCount}</b><small>{fileCountLabel}</small></span>
        {showCapacityBreakdown && <>
          <span><b>{formatStorageBytes(capacity?.logicalImmutableBytes)}</b><small>Logical immutable</small></span>
          <span><b>{formatStorageBytes(capacity?.physicalImmutableBytes)}</b><small>Physical immutable</small></span>
          <span><b>{formatStorageBytes(capacity?.replicaBytes)}</b><small>Replica/cache</small></span>
          <span><b>{formatStorageBytes(capacity?.cleanableBytes)}</b><small>Safely cleanable</small></span>
        </>}
      </div>

      {health && health.status !== 'healthy' && (
        <div role="alert" className="storage-alert storage-alert--danger">
          Automatic sync paused: this folder is {health.status}.
          {health.reason ? ` ${health.reason}` : ''}
          {health.conflicts.length ? ` Conflicts: ${health.conflicts.join(', ')}` : ''}
        </div>
      )}

      <details className="storage-git">
        <summary ref={gitSummaryRef}>
          <span>Git sync</span>
          <span className="storage-git__state">{gitLoading ? gitBusyLabel : `Git: ${gitState}`}</span>
        </summary>
        <div className="storage-git__body">
          {git?.binding?.remoteUrl && <code className="storage-git__remote">{git.binding.remoteUrl}</code>}
          {git?.binding?.lastSyncedAt && (
            <p role="status">Last sync {git.binding.lastSyncStatus ?? 'succeeded'}: {new Date(git.binding.lastSyncedAt).toLocaleString()}</p>
          )}
          {git?.binding && (
            <p role="status">This volume is already bound to {git.binding.mode} Git. To use a different repository, create another storage volume.</p>
          )}
          {git?.binding && onSetGitSecretsPolicy && (
            <fieldset className="storage-fieldset">
              <legend>High-risk data</legend>
              <label className="storage-checkbox">
                <input type="checkbox" checked={git.binding.includeSecrets === true} disabled={disabled || gitLoading} onChange={(event) => void setSecretsPolicy(event.target.checked)} />
                <span>Sync secrets to Git</span>
              </label>
              <p role="note">Git history is hard to erase. A private repository is not absolute safety. Turning this off removes secrets from the next snapshot, but does not erase existing Git history.</p>
            </fieldset>
          )}

          <div className="storage-actions">
            {git?.binding && onSync && (
              <button type="button" className="storage-button" disabled={disabled || gitLoading} onClick={() => void runGitAction('Syncing Git…', async () => { await onSync() })}>Sync now</button>
            )}
            {git?.binding?.mode === 'remote' && onPlanImport && (
              <button type="button" className="storage-button" disabled={disabled || gitLoading} onClick={() => void runGitAction('Checking remote…', async () => {
                const plan = await onPlanImport()
                setImportPlan(plan)
                setImportChoices(Object.fromEntries(plan.groups.map((group) => [group.group, group.defaultChoice])))
              })}>Check remote updates</button>
            )}
          </div>

          {importPlan && (
            <section aria-label={`${volume.name} remote import plan`} className="storage-import">
              <strong>Remote changes</strong>
              {importPlan.groups.map((group) => (
                <label key={group.group}>
                  <span>{group.group}: {group.state}</span>
                  <select className="storage-control" aria-label={`${group.group} import choice`} value={importChoices[group.group] ?? group.defaultChoice} onChange={(event) => setImportChoices((choices) => ({ ...choices, [group.group]: event.target.value }))}>
                    {group.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </label>
              ))}
              <p role="status">Remote data stays in an isolated cache until you apply these choices. Database groups are never merged.</p>
              {onApplyImport && (
                <button type="button" className="storage-button storage-button--primary" disabled={disabled || gitLoading} onClick={() => void runGitAction('Applying remote changes…', async () => {
                  restoreImportFocusRef.current = true
                  await onApplyImport(importPlan, importChoices as ImportDecisions)
                  setImportPlan(undefined)
                })}>Apply selected remote changes</button>
              )}
            </section>
          )}

          {git?.reason && <p className="storage-alert" role="status">{git.reason}</p>}
          {git?.available && !git.binding && onConfigureGit && (
            <div className="storage-git__configure">
              <button type="button" className="storage-button" disabled={disabled || gitLoading || !!pendingGitMode} onClick={(event) => requestConfigure('local', event.currentTarget)}>Configure local Git</button>
              <label>
                <span>Remote URL</span>
                <div className="storage-inline-field">
                  <input
                    ref={remoteInputRef}
                    className="storage-control"
                    aria-label={`${volume.name} Git remote URL`}
                    aria-invalid={!!remoteUrlError}
                    aria-describedby={`${remoteHelpId}${remoteUrlError ? ` ${remoteErrorId}` : ''}`}
                    disabled={disabled || gitLoading || !!pendingGitMode}
                    value={remoteUrl}
                    onChange={(event) => { setRemoteUrl(event.target.value); setRemoteUrlError(undefined) }}
                    placeholder="https://host/owner/repository.git"
                  />
                  <button type="button" className="storage-button" disabled={disabled || gitLoading || !!pendingGitMode} onClick={(event) => requestConfigure('remote', event.currentTarget)}>Configure remote Git</button>
                </div>
                {remoteUrlError && <span id={remoteErrorId} className="storage-field-error" role="alert">{remoteUrlError}</span>}
              </label>
              {pendingGitMode && (
                <div className="storage-git__confirmation" role="group" aria-label={`Confirm ${pendingGitMode} Git configuration`}>
                  <p>Configure {pendingGitMode} Git for {volume.name}? Manta never stores a password or token.</p>
                  <div className="storage-actions">
                    <button type="button" className="storage-button" disabled={disabled || gitLoading} onClick={closeGitConfirmation}>Cancel</button>
                    <button ref={gitConfirmRef} type="button" className="storage-button storage-button--primary" disabled={disabled || gitLoading} onClick={() => void confirmConfigure()}>Confirm configuration</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {git?.available && !git.binding && (
            <p id={remoteHelpId} role="status">Credential references are not supported in this build. For authenticated remotes, configure your system Git credential helper.</p>
          )}
          {gitLoading && <p role="status">{gitBusyLabel}</p>}
          {gitError && <p className="storage-alert storage-alert--danger" role="alert">{gitError}</p>}
        </div>
      </details>
    </article>
  )
}
