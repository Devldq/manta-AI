import type { ReactNode } from 'react'
import { AlertCircle, FolderOpen } from 'lucide-react'

export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="workspace-panel-state" role="status">
      <span className="sr-only">{label}</span>
      <span className="workspace-panel-skeleton is-title" aria-hidden="true" />
      <span className="workspace-panel-skeleton" aria-hidden="true" />
      <span className="workspace-panel-skeleton is-short" aria-hidden="true" />
    </div>
  )
}

export function PanelError({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="workspace-panel-state is-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <strong>加载失败</strong>
      <span>{message}</span>
      {action}
    </div>
  )
}

export function PanelEmpty({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="workspace-panel-state">
      <FolderOpen size={18} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  )
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="workspace-panel-button is-secondary" onClick={onClick}>重试</button>
}
