import type { StorageOverview as Overview } from './storage-api'
import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUPS, StorageGroupRow } from './StorageGroupRow'

export function StorageOverview({ overview, onMove = () => {}, disabled = false }: { overview: Overview; onMove?: (groupId: StorageGroupId, volumeId: string) => void; disabled?: boolean }) {
  const groups = STORAGE_GROUPS.map(([id]) => overview.groups.find((group) => group.id === id) ?? { id, volumeId: '', path: '', bytes: 0, files: 0, health: 'Not assigned', description: undefined })
  const capacity = overview.capacity
  return <section aria-label="Storage overview">
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--color-text-secondary)', fontSize: 13 }}>
      <span>Volumes: {overview.volumes.length}</span><span>Logical: {overview.logicalBytes ?? overview.groups.reduce((sum, group) => sum + group.bytes, 0)} B</span><span>Health: {groups.every((group) => group.health === 'healthy' || group.health === 'Not assigned') ? 'Healthy' : 'Needs attention'}</span>
    </div>
    {capacity && <section aria-label="Verified storage capacity" style={{ marginTop: 12, fontSize: 13 }}>
      <div>Logical immutable: {capacity.logicalImmutableBytes === null ? 'Unavailable' : `${capacity.logicalImmutableBytes} B`}</div>
      <div>Physical immutable: {capacity.physicalImmutableBytes === null ? 'Unavailable' : `${capacity.physicalImmutableBytes} B`}</div>
      <div>Replica/cache: {capacity.replicaBytes === null ? 'Unavailable' : `${capacity.replicaBytes} B`}</div>
      <div>Safely cleanable: {capacity.cleanableBytes === null ? 'Unavailable' : `${capacity.cleanableBytes} B`}</div>
      {capacity.scanStatus === 'complete' && capacity.verifiedDedupSavedBytes !== null
        ? <strong>Savings verified: {capacity.verifiedDedupSavedBytes} B</strong>
        : <><strong>{capacity.scanStatus === 'scanning' ? 'Capacity scan pending' : 'Capacity unavailable'}</strong>{capacity.blockers.map((blocker, index) => <div role="status" key={`${blocker.code}-${index}`}>{blocker.detail}</div>)}</>}
    </section>}
    <div style={{ marginTop: 12 }}>{groups.map((group) => <StorageGroupRow key={group.id} group={group} volumes={overview.volumes} onMove={onMove} disabled={disabled} />)}</div>
  </section>
}
