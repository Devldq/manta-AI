import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StorageVolumeRecord } from '@manta/shared'
import { invokeStorage } from './desktop-storage-bridge'
import { StorageOperationDialog } from './StorageOperationDialog'
import { StorageOverview } from './StorageOverview'
import { StorageVolumeCard } from './StorageVolumeCard'
import { storageApi, type StorageBackup, type StorageOverview as Overview } from './storage-api'
import { useStorageOperation } from './useStorageOperation'

type VolumeDetails = StorageVolumeRecord & { groups?: string[]; inventory?: { bytes: number; files: number } }
const EMPTY: Overview = { volumes: [], groups: [] }

function toOverview(volumes: VolumeDetails[], summary: any): Overview {
  return {
    volumes,
    logicalBytes: summary?.totalBytes,
    groups: volumes.flatMap((volume) => (volume.groups ?? []).map((id) => ({ id, volumeId: volume.id, path: `${volume.parentPath}/.manta-ai/${id}`, bytes: 0, files: 0, health: 'healthy' }))),
  }
}

export function StorageSettingsPanel() {
  const [overview, setOverview] = useState<Overview>(EMPTY)
  const [volumes, setVolumes] = useState<VolumeDetails[]>([])
  const [backups, setBackups] = useState<StorageBackup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error>()
  const [dialog, setDialog] = useState<{ title: string; body: string; action: () => Promise<void> }>()
  const operation = useStorageOperation()
  const refresh = useCallback(async () => {
    setLoading(true); setError(undefined)
    try {
      const [summary, nextVolumes, nextBackups] = await Promise.all([storageApi.overview(), storageApi.volumes(), storageApi.backups()])
      setVolumes(nextVolumes as VolumeDetails[]); setOverview(toOverview(nextVolumes as VolumeDetails[], summary)); setBackups(nextBackups)
    } catch (reason) { setError(reason as Error) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const busy = operation.busy
  const run = useCallback(async (request: Parameters<typeof invokeStorage>[0]) => { const id = await invokeStorage(request); if (id) operation.begin(id); await refresh() }, [operation, refresh])
  const createVolume = () => setDialog({ title: 'Create storage volume', body: 'Choose a parent folder. ASH will create a .manta-ai directory inside it.', action: async () => { const selectionId = await invokeStorage({ channel: 'storage:select-parent', purpose: 'createVolume' }); if (selectionId) await run({ channel: 'storage:create-volume', selectionId, name: `Volume ${volumes.length + 1}` }) } })
  const migrateVolume = (volume: VolumeDetails) => setDialog({ title: `Migrate ${volume.name}`, body: 'A verified backup remains at the current location. The app relaunches only after the new volume is committed and healthy.', action: async () => { const selectionId = await invokeStorage({ channel: 'storage:select-parent', purpose: 'migrateVolume' }); if (selectionId) await run({ channel: 'storage:relocate-volume', volumeId: volume.id, selectionId }) } })
  const moveGroup = (groupId: string, targetVolumeId: string) => setDialog({ title: 'Move storage group', body: 'The group is copied, validated, and then committed atomically. Its source remains an automatic backup.', action: () => run({ channel: 'storage:move-group', groupId: groupId as any, targetVolumeId }) })
  const content = useMemo(() => {
    if (loading) return <p role="status">Loading storage status…</p>
    if (error) return <div role="alert">{error.message} <button onClick={() => void refresh()}>Retry</button></div>
    return <>
      <StorageOverview overview={overview} onMove={moveGroup} disabled={busy} />
      <h3 style={{ marginTop: 20 }}>Volumes</h3><div style={{ display: 'grid', gap: 10 }}>{volumes.map((volume) => <StorageVolumeCard key={volume.id} volume={volume} bytes={volume.inventory?.bytes} files={volume.inventory?.files} disabled={busy} onOpen={() => void run({ channel: 'storage:open-volume', volumeId: volume.id })} onRelocate={() => migrateVolume(volume)} />)}</div>
      <button disabled={busy} onClick={createVolume} style={{ marginTop: 12 }}>Create volume</button>
      <h3 style={{ marginTop: 20 }}>Automatic backups</h3>{backups.length === 0 ? <p>No backups yet.</p> : <ul>{backups.map((backup) => <li key={backup.id}>{backup.id} · {backup.bytes ?? 0} bytes <button disabled={busy} onClick={() => setDialog({ title: 'Delete backup', body: 'This permanently removes only the verified inactive backup. Active storage can never be selected.', action: () => run({ channel: 'storage:delete-backup', backupId: backup.id }) })}>Delete backup</button></li>)}</ul>}
    </>
  }, [backups, busy, error, loading, overview, refresh, volumes])
  return <section aria-label="Storage settings" style={{ padding: 20, overflow: 'auto', height: '100%' }}><h2>Storage</h2><p style={{ color: 'var(--color-text-muted)' }}>Manage the seven ASH storage groups. Cloud folders such as iCloud sync normally through the operating system.</p>{operation.operation && <p role="status">{operation.operation.phase}: {operation.operation.progress?.message ?? 'Operation in progress'}</p>}{operation.error && <p role="alert">{operation.error.message}</p>}{content}<StorageOperationDialog open={!!dialog} title={dialog?.title ?? ''} body={dialog?.body ?? ''} confirmLabel="Confirm and continue" busy={busy} onCancel={() => setDialog(undefined)} onConfirm={() => { const current = dialog; if (current) void current.action().then(() => setDialog(undefined)).catch((reason) => setError(reason as Error)) }} /></section>
}
