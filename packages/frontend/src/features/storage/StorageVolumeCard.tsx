import type { StorageVolumeRecord } from '@manta/shared'

export function StorageVolumeCard({ volume, bytes = 0, files = 0, onRelocate, onOpen, disabled }: { volume: StorageVolumeRecord; bytes?: number; files?: number; onRelocate: () => void; onOpen: () => void; disabled: boolean }) {
  return <article aria-label={`${volume.name} volume`} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
    <strong>{volume.name}</strong><div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>{volume.parentPath}/.manta-ai</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '6px 0' }}>{bytes} bytes · {files} files</div>
    <button disabled={disabled} onClick={onOpen}>Open</button> <button disabled={disabled} onClick={onRelocate}>Migrate volume</button>
  </article>
}
