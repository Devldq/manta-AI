import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StorageGroupId } from '@manta/shared'
import { invokeStorage } from './desktop-storage-bridge'
import { StorageOperationDialog } from './StorageOperationDialog'
import { createSubmissionGate } from './submission-gate'
import { StorageOverview } from './StorageOverview'
import { StorageVolumeCard } from './StorageVolumeCard'
import { storageApi, type StorageBackup, type StorageGitBinding, type StorageGitCapability, type StorageOverview as Overview, type StorageVolumeDetails } from './storage-api'
import { useStorageOperation } from './useStorageOperation'

const EMPTY: Overview = { volumes: [], groups: [] }

export function StorageSettingsPanel() {
  const [overview, setOverview] = useState<Overview>(EMPTY)
  const [volumes, setVolumes] = useState<StorageVolumeDetails[]>([])
  const [backups, setBackups] = useState<StorageBackup[]>([])
  const [gitCapability, setGitCapability] = useState<StorageGitCapability>({ available: false })
  const [gitBindings, setGitBindings] = useState<StorageGitBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [submitting, setSubmitting] = useState(false)
  const [dialog, setDialog] = useState<{ title: string; body: string; action: () => Promise<void> }>()
  const operation = useStorageOperation()
  const submission = useMemo(() => createSubmissionGate(setSubmitting), [])
  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined)
    try {
      const [summary, nextVolumes, nextBackups, capability, bindings] = await Promise.all([storageApi.overview(), storageApi.volumes(), storageApi.backups(), storageApi.gitCapabilities(), storageApi.gitBindings()])
      setVolumes(nextVolumes); setOverview(summary); setBackups(nextBackups); setGitCapability(capability); setGitBindings(bindings); operation.resume(summary.operation, summary.operations)
    } catch (reason) { setError(reason as Error) } finally { setLoading(false) }
  // `resume` only captures stable React setters/ref; this keeps refresh stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const busy = operation.busy || submitting
  const run = useCallback(async (request: Parameters<typeof invokeStorage>[0]) => { const result = await invokeStorage(request); if (result.kind === 'operation-started') operation.begin(result.operationId); await refresh() }, [operation, refresh])
  const createVolume = () => setDialog({ title: 'Create storage volume', body: 'Choose a parent folder. ASH will create a .manta-ai directory inside it.', action: async () => { const selected = await invokeStorage({ channel: 'storage:select-parent', purpose: 'createVolume' }); if (selected.kind !== 'parent-selected' || !selected.selectionId) return; const created = await invokeStorage({ channel: 'storage:create-volume', selectionId: selected.selectionId, name: `Volume ${volumes.length + 1}` }); if (created.kind !== 'volume-created') throw new Error('Storage volume creation did not return a volume identifier'); await refresh() } })
  const migrateVolume = (volume: StorageVolumeDetails) => setDialog({ title: `Migrate ${volume.name}`, body: 'A verified backup remains at the current location. The app relaunches only after the new volume is committed and healthy.', action: async () => { const selected = await invokeStorage({ channel: 'storage:select-parent', purpose: 'migrateVolume' }); if (selected.kind === 'parent-selected' && selected.selectionId) await run({ channel: 'storage:relocate-volume', volumeId: volume.id, selectionId: selected.selectionId }) } })
  const moveGroup = (groupId: StorageGroupId, targetVolumeId: string) => setDialog({ title: 'Move storage group', body: 'The group is copied, validated, and then committed atomically. Its source remains an automatic backup.', action: () => run({ channel: 'storage:move-group', groupId, targetVolumeId }) })
  const content = useMemo(() => {
    if (loading) return <p role="status">Loading storage status…</p>
    if (error) return <div role="alert">{error.message} <button onClick={() => void refresh()}>Retry</button></div>
    return <>
      <StorageOverview overview={overview} onMove={moveGroup} disabled={busy} />
      <h3 style={{ marginTop: 20 }}>Volumes</h3><div style={{ display: 'grid', gap: 10 }}>{volumes.map((volume) => <StorageVolumeCard key={volume.id} volume={volume} bytes={volume.inventory?.bytes} files={volume.inventory?.files} disabled={busy} git={{ ...gitCapability, binding: gitBindings.find((binding) => binding.volumeId === volume.id) }} onConfigureGit={(request) => run(request)} onOpen={() => void run({ channel: 'storage:open-volume', volumeId: volume.id })} onRelocate={() => migrateVolume(volume)} />)}</div>
      <button disabled={busy} onClick={createVolume} style={{ marginTop: 12 }}>Create volume</button>
      <h3 style={{ marginTop: 20 }}>Automatic backups</h3>{backups.length === 0 ? <p>No backups yet.</p> : <ul>{backups.map((backup) => <li key={backup.id}>{backup.id} · {backup.bytes ?? 0} bytes <button disabled={busy} onClick={() => setDialog({ title: 'Delete backup', body: 'This permanently removes only the verified inactive backup. Active storage can never be selected.', action: () => run({ channel: 'storage:delete-backup', backupId: backup.id }) })}>Delete backup</button></li>)}</ul>}
    </>
  }, [backups, busy, error, gitBindings, gitCapability, loading, overview, refresh, volumes])
  return <section aria-label="Storage settings" style={{ padding: 20, overflow: 'auto', height: '100%' }}><h2>Storage</h2><p style={{ color: 'var(--color-text-muted)' }}>Manage the seven ASH storage groups. Cloud folders such as iCloud sync normally through the operating system.</p>{operation.operation && <p role="status">{operation.operation.phase}: {operation.operation.progress?.message ?? 'Operation in progress'}</p>}{operation.error && <p role="alert">{operation.error.message}</p>}{content}<StorageOperationDialog open={!!dialog} title={dialog?.title ?? ''} body={dialog?.body ?? ''} confirmLabel="Confirm and continue" busy={busy} onCancel={() => setDialog(undefined)} onConfirm={async () => { const current = dialog; if (!current) return; try { await submission.run(current.action); setDialog(undefined) } catch (reason) { setError(reason as Error) } }} /></section>
}
