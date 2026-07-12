import type { StorageOverview as Overview } from './storage-api'
import type { StorageGroupId } from '@manta/shared'
import { STORAGE_GROUPS, StorageGroupRow } from './StorageGroupRow'

export function StorageOverview({ overview, onMove = () => {}, disabled = false }: { overview: Overview; onMove?: (groupId: StorageGroupId, volumeId: string) => void; disabled?: boolean }) {
  const groups = STORAGE_GROUPS.map(([id]) => overview.groups.find((group) => group.id === id) ?? { id, volumeId: '', path: '', bytes: 0, files: 0, health: 'Not assigned', description: undefined })
  return <section aria-label="Storage overview">
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--color-text-secondary)', fontSize: 13 }}>
      <span>Volumes: {overview.volumes.length}</span><span>Logical: {overview.logicalBytes ?? overview.groups.reduce((sum, group) => sum + group.bytes, 0)} B</span><span>Health: {groups.every((group) => group.health === 'healthy' || group.health === 'Not assigned') ? 'Healthy' : 'Needs attention'}</span>
    </div>
    <div style={{ marginTop: 12 }}>{groups.map((group) => <StorageGroupRow key={group.id} group={group} volumes={overview.volumes} onMove={onMove} disabled={disabled} />)}</div>
  </section>
}
