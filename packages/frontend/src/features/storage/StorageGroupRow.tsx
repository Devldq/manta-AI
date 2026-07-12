import type { StorageVolumeRecord } from '@manta/shared'
import type { StorageOverview } from './storage-api'

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
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB` }

export function StorageGroupRow({ group, volumes, onMove, disabled }: { group: Group; volumes: StorageVolumeRecord[]; onMove: (groupId: string, volumeId: string) => void; disabled: boolean }) {
  const label = STORAGE_GROUPS.find(([id]) => id === group.id)?.[1] ?? group.id
  const description = group.description ?? STORAGE_GROUPS.find(([id]) => id === group.id)?.[2]
  return <article aria-label={`${label} storage group`} style={{ borderTop: '1px solid var(--color-border-subtle)', padding: '12px 0' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
      <div><strong>{label}</strong><div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{description}</div><div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{formatBytes(group.bytes)} · {group.files} files · {group.health}</div></div>
      <label style={{ fontSize: 12 }}>Move group <select aria-label={`Move ${label} group`} disabled={disabled || volumes.length < 2} value={group.volumeId} onChange={(event) => onMove(group.id, event.target.value)}><option value={group.volumeId}>Current volume</option>{volumes.filter((v) => v.id !== group.volumeId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    </div>
  </article>
}
