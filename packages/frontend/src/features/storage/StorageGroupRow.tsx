import type { StorageGroupId, StorageVolumeRecord } from '@manta/shared'
import type { StorageOverview } from './storage-api'
import { StorageStatusBadge } from './StoragePrimitives'
import { formatFileCount, formatStorageBytes } from './storage-ui'

export const STORAGE_GROUPS = [
  ['extensions', 'Extensions', 'Skills, plugins, and the plugin marketplace'],
  ['knowledge', 'Knowledge', 'Documents, RAG metadata, SQLite, vectors, and embeddings'],
  ['work', 'Work data', 'Sessions, tasks, workflows, and agent work data'],
  ['config', 'Configuration', 'Preferences and non-sensitive application settings'],
  ['secrets', 'Secrets', 'Credential references and protected local secrets'],
  ['diagnostics', 'Diagnostics', 'Logs, audit records, and crash diagnostics'],
  ['cache', 'Cache', 'Rebuildable downloads and transient application cache'],
] as const

type Group = StorageOverview['groups'][number]

export function StorageGroupRow({ group, volumes, onMove, disabled, moveDescriptionId }: { group: Group; volumes: StorageVolumeRecord[]; onMove: (groupId: StorageGroupId, volumeId: string) => void; disabled: boolean; moveDescriptionId?: string }) {
  const label = STORAGE_GROUPS.find(([id]) => id === group.id)?.[1] ?? group.id
  const description = group.description ?? STORAGE_GROUPS.find(([id]) => id === group.id)?.[2]
  const currentVolume = volumes.find((volume) => volume.id === group.volumeId)
  const canMove = volumes.length > 1

  return <article className="storage-group" aria-label={`${label} storage group`}>
    <div className="storage-group__identity">
      <strong>{label}</strong>
      <p>{description}</p>
    </div>
    <div className="storage-group__meta">
      <span>{formatStorageBytes(group.bytes)}</span>
      <span>{formatFileCount(group.files)}</span>
      {!canMove && <span className="storage-group__volume">Volume: {currentVolume?.name ?? 'Unassigned'}</span>}
    </div>
    <div className="storage-group__health">
      <StorageStatusBadge value={group.health} />
    </div>
    <div className="storage-group__target">
      <label>
        <span className="storage-group__target-label">Move group to</span>
        <select
          className="storage-control"
          aria-label={`Move ${label} group`}
          aria-describedby={!canMove ? moveDescriptionId : undefined}
          disabled={disabled || !canMove}
          value={group.volumeId}
          onChange={(event) => onMove(group.id, event.target.value)}
        >
          <option value={group.volumeId}>Current volume — {currentVolume?.name ?? 'Unassigned'}</option>
          {volumes
            .filter((volume) => volume.id !== group.volumeId)
            .map((volume) => <option key={volume.id} value={volume.id}>{volume.name}</option>)}
        </select>
      </label>
    </div>
  </article>
}
