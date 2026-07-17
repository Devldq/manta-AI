import { Database, Plus } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { useId } from 'react'

import { storageHealthLabel, storageHealthTone } from './storage-ui'

interface StoragePageHeaderProps {
  status: 'healthy' | 'ready' | 'warning' | 'scanning' | 'error'
  disabled: boolean
  onCreate(): void
  createButtonRef?: Ref<HTMLButtonElement>
}

interface StorageSectionProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}

export function StorageStatusBadge({ value }: { value: string }) {
  return (
    <span className="storage-status" data-tone={storageHealthTone(value)}>
      <span aria-hidden="true" className="storage-status__dot" />
      {storageHealthLabel(value)}
    </span>
  )
}

export function StoragePageHeader({ status, disabled, onCreate, createButtonRef }: StoragePageHeaderProps) {
  return (
    <header className="storage-page__header">
      <div className="storage-page__identity">
        <span className="storage-page__mark" aria-hidden="true">
          <Database size={18} />
        </span>
        <div>
          <h2>Storage</h2>
          <p>Manage ASH storage locations, groups, and connected Agent data.</p>
        </div>
      </div>
      <div className="storage-page__commands">
        <StorageStatusBadge value={status} />
        <button
          ref={createButtonRef}
          type="button"
          className="storage-button storage-button--primary"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus size={15} />
          Create volume
        </button>
      </div>
    </header>
  )
}

export function StorageSection({
  title,
  description,
  action,
  children,
}: StorageSectionProps) {
  const instanceId = useId()
  const titleSlug = title.toLowerCase().trim().replace(/\s+/g, '-')
  const titleId = `storage-${titleSlug}-${instanceId}`

  return (
    <section className="storage-section" aria-labelledby={titleId}>
      <header className="storage-section__header">
        <div>
          <h3 id={titleId}>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function StorageSkeleton() {
  return (
    <div className="storage-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="storage-sr-only">Loading storage status</span>
      <span aria-hidden="true" className="storage-skeleton__section storage-skeleton__section--volume" />
      <span aria-hidden="true" className="storage-skeleton__section storage-skeleton__section--groups" />
      <span aria-hidden="true" className="storage-skeleton__section storage-skeleton__section--agent" />
      <span aria-hidden="true" className="storage-skeleton__section storage-skeleton__section--backups" />
    </div>
  )
}
