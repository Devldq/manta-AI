import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

interface StorageOperationDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  intent?: 'default' | 'danger'
  error?: string
  onCancel: () => void
  onConfirm: () => Promise<void>
  busy: boolean
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

export function restoreStorageOperationDialogFocus(opener: HTMLElement | null, fallback: HTMLElement | null): void {
  const canReceiveFocus = (target: HTMLElement | null) => !!target
    && target.isConnected
    && !target.matches(':disabled')
    && !target.hasAttribute('disabled')
  const target = canReceiveFocus(opener) ? opener : canReceiveFocus(fallback) ? fallback : null
  target?.focus()
}

export function StorageOperationDialog({
  open,
  title,
  body,
  confirmLabel,
  intent = 'default',
  error,
  onCancel,
  onConfirm,
  busy,
  fallbackFocusRef,
}: StorageOperationDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const submittingRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const disabled = busy || submitting
  const visibleError = error ?? actionError

  useEffect(() => {
    if (open) setActionError(undefined)
  }, [open, title])

  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return
    const active = document.activeElement
    openerRef.current = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement && active !== document.body ? active : null
    if (intent === 'danger') cancelRef.current?.focus()
    else if (confirmRef.current?.disabled) dialogRef.current?.focus()
    else confirmRef.current?.focus()
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      const restoreFocus = () => restoreStorageOperationDialogFocus(opener, fallbackFocusRef?.current ?? null)
      queueMicrotask(restoreFocus)
    }
  }, [fallbackFocusRef, intent, open])

  useEffect(() => {
    if (open && disabled) dialogRef.current?.focus()
  }, [disabled, open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
          .filter((control) => !control.hasAttribute('disabled') && control.tabIndex >= 0)
        if (controls.length === 0) {
          event.preventDefault()
          dialog.focus()
          return
        }
        const first = controls[0]!
        const last = controls[controls.length - 1]!
        const active = document.activeElement
        const activeIndex = controls.indexOf(active as HTMLElement)
        if (activeIndex === -1) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && activeIndex === 0) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && activeIndex === controls.length - 1) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!disabled) onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [disabled, onCancel, open])

  const confirm = async () => {
    if (submittingRef.current || busy) return
    submittingRef.current = true
    setSubmitting(true)
    setActionError(undefined)
    try {
      await onConfirm()
    } catch (reason) {
      setActionError((reason as Error).message || 'The storage operation failed. Try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  if (!open) return null

  const describedBy = visibleError
    ? 'storage-operation-description storage-operation-error'
    : 'storage-operation-description'
  const cancel = () => {
    if (disabled) return
    setActionError(undefined)
    onCancel()
  }
  const content = <div
    data-storage-operation-overlay
    className="storage-dialog-backdrop"
    onMouseDown={(event) => { if (event.target === event.currentTarget) cancel() }}
  >
    <div
      ref={dialogRef}
      className={`storage-dialog${intent === 'danger' ? ' storage-dialog--danger' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-operation-title"
      aria-describedby={describedBy}
      tabIndex={-1}
    >
      <span className="storage-dialog__icon" aria-hidden="true">!</span>
      <div className="storage-dialog__content">
        <h3 id="storage-operation-title">{title}</h3>
        <p id="storage-operation-description">{body}</p>
        {visibleError && <p id="storage-operation-error" className="storage-alert storage-alert--danger" role="alert">{visibleError}</p>}
      </div>
      <div className="storage-dialog__actions">
        <button ref={cancelRef} type="button" className="storage-button" onClick={cancel} disabled={disabled}>Cancel</button>
        <button ref={confirmRef} type="button" className={`storage-button ${intent === 'danger' ? 'storage-button--danger' : 'storage-button--primary'}`} onClick={() => void confirm()} disabled={disabled}>{disabled ? 'Working…' : confirmLabel}</button>
      </div>
    </div>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
