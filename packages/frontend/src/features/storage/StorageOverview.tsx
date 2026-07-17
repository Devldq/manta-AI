import type { StorageOverview as Overview } from './storage-api'
import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUPS, StorageGroupRow } from './StorageGroupRow'
import { StorageStatusBadge } from './StoragePrimitives'
import { formatStorageBytes } from './storage-ui'

export function StorageOverview({ overview, onMove = () => {}, disabled = false }: { overview: Overview; onMove?: (groupId: StorageGroupId, volumeId: string) => void; disabled?: boolean }) {
  const moveHintId = 'storage-groups-move-hint'
  const groups = STORAGE_GROUPS.map(([id]) => overview.groups.find((group) => group.id === id) ?? { id, volumeId: '', path: '', bytes: 0, files: 0, health: 'Not assigned', description: undefined })
  const capacity = overview.capacity
  const logicalBytes = overview.logicalBytes ?? overview.groups.reduce((sum, group) => sum + group.bytes, 0)
  const hasFailure = groups.some((group) => group.health !== 'healthy' && group.health !== 'Not assigned')
  const allAssignedHealthy = groups.every((group) => group.health === 'healthy' && !!group.volumeId)
  const status = hasFailure ? 'warning' : allAssignedHealthy ? 'healthy' : 'ready'

  return <section aria-label="Storage overview">
    <div className="storage-capacity">
      <div className="storage-capacity__overview">
        <span><strong>{overview.volumes.length}</strong> {overview.volumes.length === 1 ? 'Volume' : 'Volumes'}</span>
        <span><strong>{formatStorageBytes(logicalBytes)}</strong> Logical</span>
        <StorageStatusBadge value={status} />
      </div>
      {capacity && <div className="storage-capacity__facts" aria-label="Verified storage capacity">
        <span>Logical immutable: {formatStorageBytes(capacity.logicalImmutableBytes)}</span>
        <span>Physical immutable: {formatStorageBytes(capacity.physicalImmutableBytes)}</span>
        <span>Replica/cache: {formatStorageBytes(capacity.replicaBytes)}</span>
        <span>Safely cleanable: {formatStorageBytes(capacity.cleanableBytes)}</span>
        {capacity.scanStatus === 'complete' && capacity.verifiedDedupSavedBytes !== null
          ? <strong>Savings verified: {formatStorageBytes(capacity.verifiedDedupSavedBytes)}</strong>
          : <div className="storage-capacity__status">
            <strong>{capacity.scanStatus === 'scanning' ? 'Capacity scan pending' : 'Capacity unavailable'}</strong>
            {capacity.blockers.map((blocker, index) => <span role="status" key={`${blocker.code}-${index}`}>{blocker.detail}</span>)}
          </div>}
      </div>}
    </div>
    {overview.volumes.length < 2 && <p id={moveHintId} className="storage-groups__hint" role="note">
      {overview.volumes.length === 0
        ? 'Create a volume to assign and move storage groups.'
        : 'Create another volume to enable storage group moves.'}
    </p>}
    <div className="storage-groups">
      <div className="storage-groups__columns" aria-hidden="true">
        <span>Group</span>
        <span>Usage</span>
        <span>Health</span>
        <span>Volume</span>
      </div>
      {groups.map((group) => <StorageGroupRow key={group.id} group={group} volumes={overview.volumes} onMove={onMove} disabled={disabled} moveDescriptionId={overview.volumes.length < 2 ? moveHintId : undefined} />)}
    </div>
  </section>
}
