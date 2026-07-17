import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ASH_VOLUME_DIR_NAME, type StorageGitImportPlan, type StorageGroupId } from '@manta/shared'
import { invokeStorage } from './desktop-storage-bridge'
import { StorageOperationDialog } from './StorageOperationDialog'
import { createSubmissionGate } from './submission-gate'
import { StorageOverview } from './StorageOverview'
import { StorageVolumeCard } from './StorageVolumeCard'
import { storageApi, type StorageBackup, type StorageGitBinding, type StorageGitCapability, type StorageOverview as Overview, type StorageVolumeDetails } from './storage-api'
import { useStorageOperation } from './useStorageOperation'
import { AgentConnectionsSection } from './AgentConnectionsSection'
import { StoragePageHeader, StorageSection, StorageSkeleton } from './StoragePrimitives'
import { formatStorageBytes, formatStorageOperation } from './storage-ui'
import './storage.css'

const EMPTY: Overview = { volumes: [], groups: [] }

type StoragePageStatus = 'healthy' | 'ready' | 'warning'

interface StorageDialogModel {
  title: string
  body: string
  confirmLabel: string
  intent?: 'default' | 'danger'
  action: () => Promise<void>
}

export async function reconcileStorageAfterMutation(
  refresh: () => Promise<void>,
  onError: (error: Error) => void,
): Promise<void> {
  try {
    await refresh()
  } catch (reason) {
    onError(reason instanceof Error ? reason : new Error(String(reason)))
  }
}

export function deriveStoragePageStatus(
  overview: Overview,
  volumes: StorageVolumeDetails[],
): StoragePageStatus {
  const volumeHealth = Object.values(overview.volumeHealth ?? {})
  if (
    overview.groups.some((group) => group.health !== 'healthy' && group.health !== 'Not assigned')
    || volumeHealth.some((health) => health.status !== 'healthy')
  ) return 'warning'

  const allGroupsAssigned = overview.groups.length > 0
    && overview.groups.every((group) => group.health === 'healthy' && !!group.volumeId)
  const allVolumesMonitored = volumes.length > 0
    && volumes.every((volume) => overview.volumeHealth?.[volume.id]?.status === 'healthy')
  return allGroupsAssigned && allVolumesMonitored ? 'healthy' : 'ready'
}

export function StorageVolumesEmpty({ busy, onCreate }: { busy: boolean; onCreate(): void }) {
  return <div className="storage-empty storage-empty--action" role="status">
    <div>
      <strong>No storage volumes</strong>
      <p>Create a volume to initialize ASH storage in a location you choose.</p>
    </div>
    <button type="button" className="storage-button storage-button--primary" disabled={busy} onClick={onCreate}>Create volume</button>
  </div>
}

export function StorageBackupRow({ backup, busy, onDelete }: { backup: StorageBackup; busy: boolean; onDelete(): void }) {
  const scope = backup.groupId
    ? `Group ${backup.groupId}`
    : backup.volumeId
      ? `Volume ${backup.volumeId}`
      : 'Storage backup'
  return <li>
    <div className="storage-backup__identity">
      <strong>{backup.id}</strong>
      {backup.path && <code>{backup.path}</code>}
      <span>
        {scope}
        {backup.createdAt && <> · <time dateTime={backup.createdAt}>{backup.createdAt}</time></>}
        {' · '}{formatStorageBytes(backup.bytes)}
      </span>
    </div>
    <button type="button" className="storage-button storage-button--danger" disabled={busy} onClick={onDelete}>Delete</button>
  </li>
}

export function StorageSettingsPanel() {
  const [overview, setOverview] = useState<Overview>(EMPTY)
  const [volumes, setVolumes] = useState<StorageVolumeDetails[]>([])
  const [backups, setBackups] = useState<StorageBackup[]>([])
  const [gitCapability, setGitCapability] = useState<StorageGitCapability>({ available: false })
  const [gitBindings, setGitBindings] = useState<StorageGitBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [actionError, setActionError] = useState<Error>()
  const [reconciliationError, setReconciliationError] = useState<Error>()
  const [submitting, setSubmitting] = useState(false)
  const [dialog, setDialog] = useState<StorageDialogModel>()
  const loadedRef = useRef(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const storagePageRef = useRef<HTMLElement>(null)
  const operation = useStorageOperation()
  const submission = useMemo(() => createSubmissionGate(setSubmitting), [])
  const refresh = useCallback(async () => {
    const initialLoad = !loadedRef.current
    if (initialLoad) setLoading(true)
    setError(undefined)
    try {
      const [summary, nextVolumes, nextBackups, capability, bindings] = await Promise.all([storageApi.overview(), storageApi.volumes(), storageApi.backups(), storageApi.gitCapabilities(), storageApi.gitBindings()])
      setVolumes(nextVolumes); setOverview(summary); setBackups(nextBackups); setGitCapability(capability); setGitBindings(bindings); operation.resume(summary.operation, summary.operations)
      loadedRef.current = true
    } catch (reason) {
      if (initialLoad) setError(reason as Error)
      else throw reason
    } finally {
      if (initialLoad) setLoading(false)
    }
  // `resume` only captures stable React setters/ref; this keeps refresh stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { void refresh().catch(() => {}) }, [refresh])
  const reconcile = useCallback(async () => {
    setReconciliationError(undefined)
    await reconcileStorageAfterMutation(refresh, setReconciliationError)
  }, [refresh])
  const busy = operation.busy || submitting
  const run = useCallback(async (request: Parameters<typeof invokeStorage>[0]) => { const result = await invokeStorage(request); if (result.kind === 'operation-started') operation.begin(result.operationId); await reconcile() }, [operation, reconcile])
  const configureGit = useCallback(async (request: Extract<Parameters<typeof invokeStorage>[0], { channel: 'storage:configure-git' }>) => { const result = await invokeStorage(request); if (result.kind !== 'git-configured') throw new Error('Git configuration did not return a binding'); await reconcile() }, [reconcile])
  const requestGitSecretsGrant = useCallback(async (volumeId: string) => { const result = await invokeStorage({ channel: 'storage:request-git-secrets-grant', volumeId }); if (result.kind !== 'git-secrets-grant') throw new Error('Git secrets confirmation did not return a grant'); return result.grant }, [])
  const setGitSecretsPolicy = useCallback(async (volumeId: string, includeSecrets: boolean, grant?: string) => { const request = includeSecrets ? { channel: 'storage:set-git-secrets-policy' as const, volumeId, includeSecrets: true as const, grant: grant! } : { channel: 'storage:set-git-secrets-policy' as const, volumeId, includeSecrets: false as const }; const result = await invokeStorage(request); if (result.kind !== 'git-secrets-policy') throw new Error('Git secrets policy was not updated'); await reconcile() }, [reconcile])
  const syncGit = useCallback(async (volumeId: string) => { const result = await invokeStorage({ channel: 'storage:sync-volume', volumeId }); if (result.kind !== 'completed') throw new Error('Git sync did not complete'); await reconcile() }, [reconcile])
  const planGitImport = useCallback(async (volumeId: string): Promise<StorageGitImportPlan> => { const result = await invokeStorage({ channel: 'storage:plan-git-import', volumeId }); if (result.kind !== 'git-import-plan') throw new Error('Git import did not return a conflict plan'); return result.plan }, [])
  const applyGitImport = useCallback(async (volumeId: string, plan: StorageGitImportPlan, decisions: Extract<Parameters<typeof invokeStorage>[0], { channel: 'storage:apply-git-import' }>['decisions']) => { const result = await invokeStorage({ channel: 'storage:apply-git-import', volumeId, sessionId: plan.sessionId, decisions }); if (result.kind !== 'completed') throw new Error('Git import did not complete'); await reconcile() }, [reconcile])
  const openVolume = useCallback(async (volumeId: string) => {
    setActionError(undefined)
    try {
      await run({ channel: 'storage:open-volume', volumeId })
    } catch (reason) {
      setActionError(reason instanceof Error ? reason : new Error(String(reason)))
    }
  }, [run])
  const createVolume = () => setDialog({ title: 'Create storage volume', body: `Choose a parent folder. ASH will create a ${ASH_VOLUME_DIR_NAME} directory inside it.`, confirmLabel: 'Choose location', action: async () => { const selected = await invokeStorage({ channel: 'storage:select-parent', purpose: 'createVolume' }); if (selected.kind !== 'parent-selected' || !selected.selectionId) return; const created = await invokeStorage({ channel: 'storage:create-volume', selectionId: selected.selectionId, name: `Volume ${volumes.length + 1}` }); if (created.kind !== 'volume-created') throw new Error('Storage volume creation did not return a volume identifier'); await reconcile() } })
  const migrateVolume = (volume: StorageVolumeDetails) => setDialog({ title: `Migrate ${volume.name}`, body: 'A verified backup remains at the current location. The app relaunches only after the new volume is committed and healthy.', confirmLabel: 'Choose new location', action: async () => { const selected = await invokeStorage({ channel: 'storage:select-parent', purpose: 'migrateVolume' }); if (selected.kind === 'parent-selected' && selected.selectionId) await run({ channel: 'storage:relocate-volume', volumeId: volume.id, selectionId: selected.selectionId }) } })
  const moveGroup = (groupId: StorageGroupId, targetVolumeId: string) => setDialog({ title: 'Move storage group', body: 'The group is copied, validated, and then committed atomically. Its source remains an automatic backup.', confirmLabel: 'Move group', action: () => run({ channel: 'storage:move-group', groupId, targetVolumeId }) })
  const operationFailed = operation.operation?.status === 'failed' || operation.operation?.phase === 'failed'
  const headerStatus = error || actionError || operation.error || operationFailed ? 'error'
    : loading ? 'scanning'
      : reconciliationError ? 'warning'
      : deriveStoragePageStatus(overview, volumes)
  const operationView = operation.operation ? formatStorageOperation(operation.operation) : undefined
  return <section ref={storagePageRef} className="storage-page" aria-label="Storage settings" tabIndex={-1}>
    <StoragePageHeader
      status={headerStatus}
      disabled={busy}
      onCreate={createVolume}
      createButtonRef={createButtonRef}
    />
    {operationView && <div className="storage-operation" role={operationFailed ? 'alert' : 'status'} data-tone={operationFailed ? 'danger' : 'neutral'}>
      <span>{operationView.phase}</span>
      <div className="storage-operation__content">
        <strong>{operationView.message}</strong>
        {operationView.metrics.length > 0 && <small>{operationView.metrics.join(' · ')}</small>}
      </div>
    </div>}
    {operation.error && <div className="storage-alert storage-alert--danger" role="alert">{operation.error.message}</div>}
    {actionError && <div className="storage-alert storage-alert--danger storage-retry" role="alert">
      <span>Could not open the storage folder. {actionError.message}</span>
      <button type="button" className="storage-button" onClick={() => setActionError(undefined)}>Dismiss</button>
    </div>}
    {reconciliationError && <div className="storage-alert storage-retry" role="alert">
      <span>Storage changed successfully, but the latest status could not be loaded. {reconciliationError.message}</span>
      <button type="button" className="storage-button" onClick={() => void reconcile()}>Refresh status</button>
    </div>}
    {loading ? <StorageSkeleton /> : error ? <div className="storage-alert storage-alert--danger storage-retry" role="alert">
      <span>{error.message}</span>
      <button type="button" className="storage-button" onClick={() => void refresh().catch((reason) => setError(reason as Error))}>Retry</button>
    </div> : <>
      <StorageSection title="Volumes" description="Physical locations managed by ASH.">
        {volumes.length === 0 ? <StorageVolumesEmpty busy={busy} onCreate={createVolume} /> : <div className="storage-volumes">{volumes.map((volume) => <StorageVolumeCard
          key={volume.id}
          volume={volume}
          bytes={volume.inventory?.bytes}
          files={volume.inventory?.files}
          capacity={volume.capacity ?? overview.volumeCapacity?.find((item) => item.volumeId === volume.id)}
          showCapacityBreakdown={volumes.length > 1}
          disabled={busy}
          git={{ ...gitCapability, binding: gitBindings.find((binding) => binding.volumeId === volume.id) }}
          health={overview.volumeHealth?.[volume.id]}
          onConfigureGit={configureGit}
          onRequestGitSecretsGrant={() => requestGitSecretsGrant(volume.id)}
          onSetGitSecretsPolicy={(include, grant) => setGitSecretsPolicy(volume.id, include, grant)}
          onSync={() => syncGit(volume.id)}
          onPlanImport={() => planGitImport(volume.id)}
          onApplyImport={(plan, decisions) => applyGitImport(volume.id, plan, decisions)}
          onOpen={() => void openVolume(volume.id)}
          onRelocate={() => migrateVolume(volume)}
        />)}</div>}
      </StorageSection>
      <StorageSection title="Storage groups" description="Seven portable data domains routed across your volumes.">
        <StorageOverview overview={overview} onMove={moveGroup} disabled={busy} />
      </StorageSection>
      <AgentConnectionsSection />
      <StorageSection title="Automatic backups" description="Verified inactive copies retained after storage changes.">
        {backups.length === 0 ? <div className="storage-empty storage-empty--compact">
          <strong>No automatic backups</strong>
          <p>Verified inactive backups appear here after a migration.</p>
        </div> : <ul className="storage-backups">{backups.map((backup) => <StorageBackupRow
          key={backup.id}
          backup={backup}
          busy={busy}
          onDelete={() => setDialog({
              title: 'Delete backup',
              body: 'This permanently removes only the verified inactive backup. Active storage can never be selected.',
              confirmLabel: 'Delete backup',
              intent: 'danger',
              action: () => run({ channel: 'storage:delete-backup', backupId: backup.id }),
          })}
        />)}</ul>}
      </StorageSection>
    </>}
    <StorageOperationDialog
      open={!!dialog}
      title={dialog?.title ?? ''}
      body={dialog?.body ?? ''}
      confirmLabel={dialog?.confirmLabel ?? 'Confirm'}
      intent={dialog?.intent}
      busy={busy}
      fallbackFocusRef={storagePageRef}
      onCancel={() => setDialog(undefined)}
      onConfirm={async () => {
        const current = dialog
        if (!current) return
        await submission.run(current.action)
        setDialog(undefined)
      }}
    />
  </section>
}
