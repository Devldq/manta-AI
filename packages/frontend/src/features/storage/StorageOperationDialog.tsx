export function StorageOperationDialog({ open, title, body, confirmLabel, onCancel, onConfirm, busy }: { open: boolean; title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  if (!open) return null
  return <div role="dialog" aria-modal="true" aria-labelledby="storage-operation-title" style={{ padding: 16, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}><h3 id="storage-operation-title">{title}</h3><p>{body}</p><button onClick={onCancel} disabled={busy}>Cancel</button> <button onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></div>
}
