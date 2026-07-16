import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function StorageOperationDialog({ open, title, body, confirmLabel, onCancel, onConfirm, busy }: { open: boolean; title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => Promise<void>; busy: boolean }) {
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const disabled = busy || submitting

  if (!open) return null
  const confirm = async () => {
    if (submittingRef.current || busy) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const content = <div
    data-storage-operation-overlay
    style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0, 0, 0, 0.58)', backdropFilter: 'blur(3px)' }}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel() }}
  >
    <div role="dialog" aria-modal="true" aria-labelledby="storage-operation-title" style={{ width: 'min(440px, 100%)', padding: 20, border: '1px solid var(--color-border)', borderRadius: 12, background: 'var(--color-surface)', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)' }}>
      <h3 id="storage-operation-title" style={{ marginTop: 0 }}>{title}</h3>
      <p>{body}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button onClick={onCancel} disabled={disabled}>Cancel</button><button onClick={() => void confirm()} disabled={disabled}>{disabled ? 'Working…' : confirmLabel}</button></div>
    </div>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
