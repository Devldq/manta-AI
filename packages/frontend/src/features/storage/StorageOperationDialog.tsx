import { useRef, useState } from 'react'

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

  return <div role="dialog" aria-modal="true" aria-labelledby="storage-operation-title" style={{ padding: 16, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)' }}><h3 id="storage-operation-title">{title}</h3><p>{body}</p><button onClick={onCancel} disabled={disabled}>Cancel</button> <button onClick={() => void confirm()} disabled={disabled}>{disabled ? 'Working…' : confirmLabel}</button></div>
}
