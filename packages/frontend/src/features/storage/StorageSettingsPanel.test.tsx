import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { StorageOverview } from './StorageOverview'
import { StorageGroupRow } from './StorageGroupRow'
import { restoreStorageOperationDialogFocus, StorageOperationDialog } from './StorageOperationDialog'
import {
  deriveStoragePageStatus,
  reconcileStorageAfterMutation,
  StorageBackupRow,
  StorageSettingsPanel,
  StorageVolumesEmpty,
} from './StorageSettingsPanel'
import {
  StoragePageHeader,
  StorageSection,
  StorageSkeleton,
  StorageStatusBadge,
} from './StoragePrimitives'
import { StorageVolumeCard } from './StorageVolumeCard'

describe('storage settings presentation', () => {
  it('separates a successful mutation from a failed status reconciliation', async () => {
    const mutate = vi.fn(async () => {})
    const refresh = vi.fn(async () => { throw new Error('refresh unavailable') })
    const report = vi.fn()

    await expect((async () => {
      await mutate()
      await reconcileStorageAfterMutation(refresh, report)
    })()).resolves.toBeUndefined()

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'refresh unavailable' }))
  })

  it('renders the Storage command header and accessible primary action', () => {
    const html = renderToStaticMarkup(
      <StoragePageHeader status="healthy" onCreate={() => {}} disabled />,
    )

    expect(html).toContain('Storage')
    expect(html).toContain('Manta AI storage')
    expect(html).toContain('Healthy')
    expect(html).toContain('Create volume')
    expect(html).toContain('storage-button--primary')
    expect(html).toContain('<button type="button"')
    expect(html).toContain('disabled=""')
  })

  it.each([
    ['scanning', 'Scanning'],
    ['error', 'Error'],
    ['warning', 'Warning'],
    ['ready', 'Ready'],
    ['healthy', 'Healthy'],
  ] as const)('renders the explicit %s page status', (status, label) => {
    const html = renderToStaticMarkup(<StoragePageHeader status={status} onCreate={() => {}} disabled={false} />)
    expect(html).toContain(label)
  })

  it('starts as scanning, never claims empty data is healthy, and uses a region landmark', () => {
    const html = renderToStaticMarkup(<StorageSettingsPanel />)
    const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')

    expect(html).toContain('<section class="storage-page" aria-label="Storage settings" tabindex="-1">')
    expect(html).toContain('Scanning')
    expect(html).not.toContain('Healthy')
    expect(source).not.toContain('<main className="storage-page"')
    expect(source).toContain("loading ? 'scanning'")
    expect(source).toContain("error || actionError || operation.error || operationFailed ? 'error'")
    expect(source).toContain('deriveStoragePageStatus(overview, volumes)')
  })

  it('keeps loaded Storage content mounted when opening a volume fails', () => {
    const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
    const openHandler = source.slice(source.indexOf('const openVolume'), source.indexOf('const createVolume'))

    expect(source).toContain('const [actionError, setActionError]')
    expect(source).toContain('storage-alert storage-alert--danger storage-retry')
    expect(source).toContain('Dismiss')
    expect(openHandler).toContain('setActionError')
    expect(openHandler).not.toContain('setError')
    expect(source).toContain('onOpen={() => void openVolume(volume.id)}')
  })

  it('announces a failed terminal operation as an alert instead of a live progress update', () => {
    const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')

    expect(source).toContain("role={operationFailed ? 'alert' : 'status'}")
    expect(source).toContain("data-tone={operationFailed ? 'danger' : 'neutral'}")
    expect(css).toMatch(/\.storage-operation\[data-tone='danger'\]/)
  })

  it('derives aggregate health from groups and explicit volume evidence', () => {
    const volume = { id: 'volume-1', name: 'Default', parentPath: '/data', createdAt: '', updatedAt: '', groups: [], inventory: { bytes: 0, files: 0 } }
    const healthyGroups = [{ id: 'knowledge' as const, volumeId: 'volume-1', path: '', bytes: 0, files: 0, health: 'healthy' }]

    expect(deriveStoragePageStatus({ volumes: [volume], groups: healthyGroups }, [volume])).toBe('ready')
    expect(deriveStoragePageStatus({ volumes: [volume], groups: healthyGroups, volumeHealth: { 'volume-1': { status: 'conflict', conflicts: [], checkedAt: '' } } }, [volume])).toBe('warning')
    expect(deriveStoragePageStatus({ volumes: [], groups: [] }, [])).toBe('ready')
    expect(deriveStoragePageStatus({ volumes: [volume], groups: healthyGroups, volumeHealth: { 'volume-1': { status: 'healthy', conflicts: [], checkedAt: '' } } }, [volume])).toBe('healthy')
  })

  it('renders a loaded Volumes empty state with a reachable Create action', () => {
    const html = renderToStaticMarkup(<StorageVolumesEmpty busy={false} onCreate={() => {}} />)
    expect(html).toContain('No storage volumes')
    expect(html).toContain('Create volume')
    expect(html).toContain('storage-button--primary')
  })

  it('renders reusable section, status, and loading semantics', () => {
    const html = renderToStaticMarkup(
      <>
        <StorageSection title="Volumes" description="Storage locations">
          Content
        </StorageSection>
        <StorageStatusBadge value="conflict" />
        <StorageSkeleton />
      </>,
    )

    expect(html).toContain('Storage locations')
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('<span class="storage-sr-only">Loading storage status</span>')
    expect(html.match(/aria-hidden="true" class="storage-skeleton__section /g)).toHaveLength(3)
    expect(html.match(/class="storage-skeleton__section /g)).toHaveLength(3)
    for (const section of ['volume', 'groups', 'backups']) expect(html).toContain(`storage-skeleton__section--${section}`)
  })

  it('assigns each same-title section its own labelled heading', () => {
    const html = renderToStaticMarkup(
      <>
        <StorageSection title="Volumes">Primary content</StorageSection>
        <StorageSection title="Volumes">Secondary content</StorageSection>
      </>,
    )
    const sectionLabels = [...html.matchAll(
      /<section class="storage-section" aria-labelledby="([^"]+)">/g,
    )].map((match) => match[1])
    const headingIds = [...html.matchAll(
      /<h3 id="([^"]+)">Volumes<\/h3>/g,
    )].map((match) => match[1])

    expect(sectionLabels).toHaveLength(2)
    expect(headingIds).toHaveLength(2)
    expect(new Set(headingIds).size).toBe(2)
    expect(sectionLabels).toEqual(headingIds)
    expect(headingIds.every((id) => id?.startsWith('storage-volumes-'))).toBe(true)
  })

  it('composes the Storage command hierarchy and imports its design layer once', () => {
    const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
    expect(source.match(/import ['"]\.\/storage\.css['"]/g)).toHaveLength(1)
    const header = source.indexOf('<StoragePageHeader')
    const volumes = source.indexOf('title="Volumes"')
    const groups = source.indexOf('title="Storage groups"')
    const backups = source.indexOf('title="Automatic backups"')
    expect(header).toBeGreaterThan(-1)
    expect(volumes).toBeGreaterThan(-1)
    expect(header).toBeLessThan(volumes)
    expect(volumes).toBeLessThan(groups)
    expect(groups).toBeLessThan(backups)
    expect(source).toContain('Verified inactive backups appear here after a migration.')
    expect(source).toContain('storage-empty storage-empty--compact')
    expect(source).toContain('backup.path &&')
    expect(source).toContain('backup.volumeId')
  })

  it('shows verified capacity categories and a savings claim only for a complete scan', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [], capacity: { scanStatus: 'complete', logicalImmutableBytes: 100, physicalImmutableBytes: 60, verifiedDedupSavedBytes: 40, replicaBytes: 9, cleanableBytes: 3, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [] } }} />)
    for (const text of ['Logical immutable: 100 B', 'Physical immutable: 60 B', 'Replica/cache: 9 B', 'Safely cleanable: 3 B', 'Savings verified: 40 B']) expect(html).toContain(text)
  })

  it('uses singular volume copy for a one-volume overview', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [{ id: 'volume-1', name: 'Default', parentPath: '/data', createdAt: '', updatedAt: '' }], groups: [] }} />)
    expect(html).toContain('<strong>1</strong> Volume')
    expect(html).not.toContain('<strong>1</strong> Volumes')
    expect(html.match(/Create another volume to enable storage group moves\./g)).toHaveLength(1)
    expect(html.match(/aria-describedby="storage-groups-move-hint"/g)).toHaveLength(7)
  })

  it.each(['degraded', 'scanning'] as const)('never renders a numeric savings claim for %s capacity', (scanStatus) => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [], capacity: { scanStatus, logicalImmutableBytes: 100, physicalImmutableBytes: null, verifiedDedupSavedBytes: null, replicaBytes: 9, cleanableBytes: null, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [{ code: 'allocation-unavailable', detail: 'Allocation evidence unavailable' }] } }} />)
    expect(html).not.toContain('Savings verified'); expect(html).not.toContain('Savings: 0'); expect(html).toContain(scanStatus === 'scanning' ? 'Capacity scan pending' : 'Capacity unavailable'); expect(html).toContain('Allocation evidence unavailable')
  })

  it('renders all seven ASH storage groups with their user-facing descriptions and health', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [] }} />)
    for (const group of ['Extensions', 'Knowledge', 'Work data', 'Configuration', 'Secrets', 'Diagnostics', 'Cache']) expect(html).toContain(group)
    expect(html).toContain('class="storage-groups__columns"')
    for (const heading of ['Group', 'Usage', 'Health', 'Volume']) expect(html).toContain(`>${heading}<`)
    expect(html.match(/Create a volume to assign and move storage groups\./g)).toHaveLength(1)
    expect(html.match(/aria-describedby="storage-groups-move-hint"/g)).toHaveLength(7)
    expect(html).toContain('Not assigned')
    expect(html).toContain('Ready')
    expect(html).not.toContain('Healthy')
  })

  it('renders group inventory and a move control instead of exposing filesystem controls', () => {
    const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '/private/manta-ai-data/knowledge', bytes: 1024, files: 2, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]} onMove={() => {}} disabled={false} />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('1 KB')
    expect(html).toContain('Move group')
    expect(html).not.toContain('input type="file"')
  })

  it('disables a single-volume move selector without repeating the global prerequisite', () => {
    const html = renderToStaticMarkup(
      <StorageGroupRow
        group={{ id: 'knowledge', volumeId: 'volume-1', path: '/private/manta-ai-data/knowledge', bytes: 2_621_440, files: 1243, health: 'healthy' }}
        volumes={[{ id: 'volume-1', name: 'Default', parentPath: '/private', createdAt: '', updatedAt: '' }]}
        onMove={() => {}}
        disabled={false}
      />,
    )

    expect(html).toContain('2.5 MB')
    expect(html).toContain('1,243 files')
    expect(html).not.toContain('Create another volume')
    expect(html).toContain('disabled=""')
  })

  it('hides redundant single-volume move selects only on the narrowest layout', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(max-width: 420px\)[\s\S]*\.storage-group__target:has\(select\[aria-describedby="storage-groups-move-hint"\]\)\s*\{[\s\S]*display:\s*none/)
    expect(css).toMatch(/\.storage-group__volume\s*\{[\s\S]*display:\s*none/)
    expect(css).toMatch(/@media \(max-width: 420px\)[\s\S]*\.storage-group__volume\s*\{[\s\S]*display:\s*inline/)
  })

  it('retains compact current-volume metadata when a narrow single-volume selector is hidden', () => {
    const html = renderToStaticMarkup(
      <StorageGroupRow
        group={{ id: 'knowledge', volumeId: 'volume-1', path: '', bytes: 0, files: 0, health: 'healthy' }}
        volumes={[{ id: 'volume-1', name: 'Default', parentPath: '/one', createdAt: '', updatedAt: '' }]}
        onMove={() => {}}
        disabled={false}
      />,
    )

    expect(html).toContain('class="storage-group__volume"')
    expect(html).toContain('Volume: Default')
  })

  it('renders another volume as a valid move target', () => {
    const html = renderToStaticMarkup(
      <StorageGroupRow
        group={{ id: 'knowledge', volumeId: 'volume-1', path: '', bytes: 0, files: 0, health: 'healthy' }}
        volumes={[
          { id: 'volume-1', name: 'Default', parentPath: '/one', createdAt: '', updatedAt: '' },
          { id: 'volume-2', name: 'Archive', parentPath: '/two', createdAt: '', updatedAt: '' },
        ]}
        onMove={() => {}}
        disabled={false}
      />,
    )

    expect(html).toContain('Archive')
    expect(html).not.toContain('Create another volume to move.')
  })

  it('keeps the Move label for assistive tech while giving the select the full action width', () => {
    const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '', bytes: 0, files: 0, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Default volume', parentPath: '/one', createdAt: '', updatedAt: '' }]} onMove={() => {}} disabled={false} />)
    expect(html).toContain('<span class="storage-group__target-label">Move group to</span>')
    expect(html).toContain('Current volume — Default volume')
  })

  it('renders volume facts as compact key-value rows and keeps narrow group rows parallel', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const facts = css.match(/\.storage-volume__facts\s*\{([^}]*)\}/)?.[1] ?? ''
    const fact = css.match(/\.storage-volume__facts > span\s*\{([^}]*)\}/)?.[1] ?? ''
    const factLabel = css.match(/\.storage-volume__facts small\s*\{([^}]*)\}/)?.[1] ?? ''
    const targetLabel = css.match(/\.storage-group__target-label\s*\{([^}]*)\}/)?.[1] ?? ''
    const narrow = css.slice(css.indexOf('@media (max-width: 760px)'), css.indexOf('@media (max-width: 680px)'))

    expect(facts).toMatch(/gap:\s*8px 20px/)
    expect(fact).toMatch(/display:\s*flex/)
    expect(fact).toMatch(/justify-content:\s*space-between/)
    expect(factLabel).toMatch(/order:\s*-1/)
    expect(targetLabel).toMatch(/position:\s*absolute/)
    expect(narrow).toMatch(/grid-template-areas:\s*"identity health"\s*"meta meta"\s*"target target"/)
  })

  it('renders storage confirmations above the Settings portal without inline stacking styles', () => {
    const html = renderToStaticMarkup(<StorageOperationDialog open title="Create storage volume" body="Choose a parent folder." confirmLabel="Confirm and continue" busy={false} onCancel={() => {}} onConfirm={async () => {}} />)
    const source = readFileSync(new URL('./StorageOperationDialog.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')

    expect(html).toContain('data-storage-operation-overlay="true"')
    expect(html).toContain('class="storage-dialog-backdrop"')
    expect(html).toContain('class="storage-dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).not.toContain('autofocus')
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).not.toContain('zIndex:')
    expect(source).not.toContain("position: 'fixed'")
    expect(css).toContain('--storage-z-backdrop: 10000')
    expect(css).toContain('--storage-z-dialog: 10001')
    expect(css).toContain('z-index: var(--storage-z-backdrop)')
    expect(css).toContain('z-index: var(--storage-z-dialog)')
  })

  it('captures Escape before the parent Settings listener and blocks it even while busy', () => {
    const source = readFileSync(new URL('./StorageOperationDialog.tsx', import.meta.url), 'utf8')
    const escapeHandler = source.slice(source.indexOf('const onKeyDown'), source.indexOf("document.addEventListener('keydown'"))

    expect(source).toContain("document.addEventListener('keydown', onKeyDown, true)")
    expect(source).toContain("document.removeEventListener('keydown', onKeyDown, true)")
    expect(escapeHandler).toContain("if (event.key !== 'Escape') return")
    expect(escapeHandler.indexOf('event.preventDefault()')).toBeLessThan(escapeHandler.indexOf('if (!disabled)'))
    expect(escapeHandler.indexOf('event.stopImmediatePropagation()')).toBeLessThan(escapeHandler.indexOf('if (!disabled)'))
    expect(escapeHandler.indexOf('onCancel()')).toBeGreaterThan(escapeHandler.indexOf('if (!disabled)'))
  })

  it('traps dialog focus and restores the command that opened it', () => {
    const source = readFileSync(new URL('./StorageOperationDialog.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')

    expect(source).toContain('const dialogRef = useRef<HTMLDivElement>')
    expect(source).toContain('const confirmRef = useRef<HTMLButtonElement>')
    expect(source).toContain('useLayoutEffect(() =>')
    expect(source).toContain('openerRef.current = null')
    expect(source).toContain('confirmRef.current?.focus()')
    expect(source).toContain("event.key === 'Tab'")
    expect(source).toContain('querySelectorAll<HTMLElement>')
    expect(source).toContain('event.shiftKey')
    expect(source).toContain('controls.indexOf(active as HTMLElement)')
    expect(source).toContain('activeIndex === -1')
    expect(source).toContain('dialog.focus()')
    expect(source).toContain('restoreStorageOperationDialogFocus(opener')
    expect(source).toContain('queueMicrotask(restoreFocus)')
    expect(source).toContain('ref={dialogRef}')
    expect(source).toContain('ref={confirmRef}')
    expect(source).toContain('tabIndex={-1}')
    expect(source).not.toContain('autoFocus')
    expect(source).not.toContain('onFocusCapture')
    expect(source).not.toContain('openerCapturedRef')
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.storage-dialog-backdrop \*/)
  })

  it('restores focus to a stable page anchor when the operation disables its opener', () => {
    const events: string[] = []
    const target = (name: string, disabled: boolean) => ({
      isConnected: true,
      matches: (selector: string) => selector === ':disabled' && disabled,
      hasAttribute: (attribute: string) => attribute === 'disabled' && disabled,
      focus: () => { events.push(name) },
    }) as unknown as HTMLElement

    restoreStorageOperationDialogFocus(target('move selector', true), target('storage page', false))

    expect(events).toEqual(['storage page'])
    expect(readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')).toContain('fallbackFocusRef={storagePageRef}')
  })

  it('keeps the operation dialog compact, opaque, and flat', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const dialog = css.match(/\.storage-dialog\s*\{([^}]*)\}/)?.[1] ?? ''
    const backdrop = css.match(/\.storage-dialog-backdrop\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(dialog).toContain('border-radius: var(--radius-lg)')
    expect(dialog).not.toContain('--radius-xl')
    expect(dialog).not.toContain('box-shadow')
    expect(backdrop).not.toContain('backdrop-filter')
    expect(backdrop).toContain('--color-background: #f8f6f0')
    expect(backdrop).toContain('--color-surface: #ffffff')
    expect(backdrop).toContain('--color-status-failed: #b42318')
    expect(css).toMatch(/\.dark \.storage-dialog-backdrop\s*\{[\s\S]*--color-background: #0a0a14[\s\S]*--color-status-failed: #f97066/)
  })

  it('keeps long operation content reachable in short viewports', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const dialog = css.match(/\.storage-dialog\s*\{([^}]*)\}/)?.[1] ?? ''
    const content = css.match(/\.storage-dialog__content\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(dialog).toContain('max-height: calc(100dvh - 48px)')
    expect(dialog).toContain('overflow-y: auto')
    expect(content).toContain('min-width: 0')
    expect(content).toContain('overflow-wrap: anywhere')
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*\.storage-dialog\s*\{[\s\S]*max-height:\s*calc\(100dvh - 24px\)/)
  })

  it('uses section-shaped loading placeholders for the remaining storage sections', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')

    for (const section of ['volume', 'groups', 'backups']) {
      expect(css).toMatch(new RegExp(`\\.storage-skeleton__section--${section}\\s*\\{[^}]*min-height:`))
    }
    expect(css).not.toContain('storage-skeleton__section--agent')
  })

  it('keeps the two mobile volume actions on one compact row', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const mobile = css.slice(
      css.indexOf('@media (max-width: 420px)'),
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
    )

    expect(mobile).toMatch(/\.storage-volume__header \.storage-actions\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) max-content/)
  })

  it('defines complete control states and 44px mobile checkbox targets', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const mobile = css.slice(
      css.indexOf('@media (max-width: 420px)'),
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
    )

    expect(css).toMatch(/\.storage-control:hover:not\(:disabled\)/)
    expect(css).toMatch(/\.storage-control:active:not\(:disabled\)/)
    expect(css).toMatch(/\.storage-git > summary:hover/)
    expect(css).toMatch(/\.storage-button--danger:active:not\(:disabled\)/)
    expect(css).toMatch(/\.storage-checkbox:has\(input:disabled\)/)
    expect(mobile).toMatch(/\.storage-checkbox\s*\{[\s\S]*min-height:\s*44px/)
  })

  it('renders action-specific destructive confirmation and an in-dialog error', () => {
    const html = renderToStaticMarkup(<StorageOperationDialog open title="Delete backup" body="This cannot be undone." confirmLabel="Delete backup" intent="danger" error="Deletion failed" busy={false} onCancel={() => {}} onConfirm={async () => {}} />)
    const source = readFileSync(new URL('./StorageOperationDialog.tsx', import.meta.url), 'utf8')

    expect(html).toContain('storage-button--danger')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Deletion failed')
    expect(source).toContain("intent === 'danger'")
    expect(source).toContain('cancelRef.current?.focus()')
    expect(source).toContain('setActionError(undefined)')
    expect(source).toContain('fallbackFocusRef?.current ?? null')
  })

  it('keeps busy dialog cancellation disabled and communicates progress', () => {
    const html = renderToStaticMarkup(<StorageOperationDialog open title="Move storage group" body="Moving safely." confirmLabel="Confirm and continue" busy onCancel={() => {}} onConfirm={async () => {}} />)

    expect(html).toContain('Working…')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('storage-button--primary')
  })

  it('renders real group and volume backup scopes without undefined runtime fields', () => {
    const groupHtml = renderToStaticMarkup(<ul><StorageBackupRow
      backup={{ id: 'operation-1--work', operationId: 'operation-1', kind: 'group', groupId: 'work', bytes: 2048, createdAt: '2026-07-16T10:00:00.000Z' }}
      busy={false}
      onDelete={() => {}}
    /></ul>)
    const volumeHtml = renderToStaticMarkup(<ul><StorageBackupRow
      backup={{ id: 'operation-2--volume-1', operationId: 'operation-2', kind: 'volume', volumeId: 'volume-1', bytes: 4096, createdAt: '2026-07-16T11:00:00.000Z' }}
      busy={false}
      onDelete={() => {}}
    /></ul>)
    const fallbackHtml = renderToStaticMarkup(<ul><StorageBackupRow
      backup={{ id: 'legacy-backup', bytes: 0, createdAt: '2026-07-16T12:00:00.000Z' }}
      busy={false}
      onDelete={() => {}}
    /></ul>)

    expect(groupHtml).toContain('Group work')
    expect(groupHtml).toContain('2 KB')
    expect(volumeHtml).toContain('Volume volume-1')
    expect(volumeHtml).toContain('4 KB')
    expect(fallbackHtml).toContain('Storage backup')
    for (const html of [groupHtml, volumeHtml, fallbackHtml]) {
      expect(html).not.toContain('undefined')
      expect(html).toContain('storage-button--danger')
    }
  })

  it('renders a compact Manta volume panel with readable facts and closed progressive Git controls', () => {
    const html = renderToStaticMarkup(
      <StorageVolumeCard
        volume={{ id: 'volume-1', name: 'Default', parentPath: '/Users/example/Documents', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }}
        bytes={4_796_804}
        files={255}
        capacity={{ volumeId: 'volume-1', scanStatus: 'complete', logicalImmutableBytes: 2_046_598, physicalImmutableBytes: 2_248_704, verifiedDedupSavedBytes: 0, replicaBytes: 0, cleanableBytes: 0, scannedAt: '2026-01-01T00:00:00.000Z', blockers: [] }}
        disabled={false}
        onOpen={() => {}}
        onRelocate={() => {}}
        git={{ available: true }}
        onConfigureGit={() => {}}
      />,
    )

    expect(html).toContain('class="storage-volume"')
    expect(html).toContain('/Users/example/Documents/manta-ai-data')
    expect(html).toContain('4.6 MB')
    expect(html).toContain('>255<')
    expect(html).toContain('>Files<')
    expect(html).toContain('2 MB')
    expect(html).toContain('2.1 MB')
    expect(html).toContain('Replica/cache')
    expect(html).toContain('Safely cleanable')

    const detailsStart = html.indexOf('<details class="storage-git">')
    const detailsEnd = html.indexOf('</details>', detailsStart)
    expect(detailsStart).toBeGreaterThan(-1)
    expect(detailsEnd).toBeGreaterThan(detailsStart)
    expect(html.slice(detailsStart, detailsEnd)).toContain('Git sync')
    expect(html.slice(detailsStart, detailsEnd)).toContain('Configure local Git')
    expect(html.slice(detailsStart, detailsEnd)).toContain('Configure remote Git')
    expect(html).not.toContain('<details class="storage-git" open')
  })

  it('uses a singular file label without duplicating the unit', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Single', parentPath: '/data', createdAt: '', updatedAt: '' }} files={1} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)
    expect(html).toContain('<b>1</b><small>File</small>')
    expect(html).not.toContain('1 file')
  })

  it('shows the exact directory selected by new onboarding records', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Exact', parentPath: '/Users/example', rootPath: '/Volumes/My Manta Data', createdAt: '', updatedAt: '' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)
    expect(html).toContain('/Volumes/My Manta Data')
    expect(html).not.toContain('/Volumes/My Manta Data/manta-ai-data')
  })

  it('avoids repeating global capacity facts when only one volume exists', () => {
    const CompactVolumeCard = StorageVolumeCard as any
    const html = renderToStaticMarkup(<CompactVolumeCard
      volume={{ id: 'volume-1', name: 'Only volume', parentPath: '/data', createdAt: '', updatedAt: '' }}
      bytes={4096}
      files={3}
      capacity={{ volumeId: 'volume-1', scanStatus: 'complete', logicalImmutableBytes: 2048, physicalImmutableBytes: 1024, verifiedDedupSavedBytes: 0, replicaBytes: 0, cleanableBytes: 0, scannedAt: '', blockers: [] }}
      showCapacityBreakdown={false}
      disabled={false}
      onOpen={() => {}}
      onRelocate={() => {}}
    />)
    expect(html).toContain('Stored')
    expect(html).toContain('Files')
    expect(html).not.toContain('Logical immutable')
    expect(html).not.toContain('Physical immutable')

    const panelSource = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
    expect(panelSource).toContain('showCapacityBreakdown={volumes.length > 1}')
  })

  it('shows unavailable volume evidence instead of inventing zeroes or a healthy state', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Unmonitored', parentPath: '/data', createdAt: '', updatedAt: '' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)
    expect(html).toContain('Not monitored')
    expect(html.match(/Unavailable/g)?.length).toBeGreaterThanOrEqual(6)
    expect(html).not.toContain('Healthy')
  })

  it('hides the Git body while closed and restores its grid only when the disclosure opens', () => {
    const css = readFileSync(new URL('./storage.css', import.meta.url), 'utf8')
    const declarationsFor = (selector: string) => {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    }

    expect(declarationsFor('.storage-git:not([open]) > .storage-git__body'))
      .toMatch(/display:\s*none/)
    expect(declarationsFor('.storage-git[open] > .storage-git__body'))
      .toMatch(/display:\s*grid/)
    expect(declarationsFor('.storage-git__body')).not.toMatch(/display\s*:/)
  })

  it('shows Git binding state without impossible reconfiguration controls', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onConfigureGit={() => {}} />)
    expect(html).toContain('Git: remote')
    expect(html).toContain('/private/manta-ai-data')
    expect(html).not.toContain('/private/.manta-ai')
    expect(html).toContain('https://example.test/ash.git')
    expect(html).not.toContain('Configure local Git')
    expect(html).not.toContain('Configure remote Git')
    expect(html).not.toContain('Credential references are not supported')
    expect(html).not.toContain('password')
    expect(html).not.toContain('token')
  })

  it('uses inline Git confirmation and associates URL validation with its input', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '', updatedAt: '' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true }} onConfigureGit={() => {}} />)
    const source = readFileSync(new URL('./StorageVolumeCard.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('window.confirm')
    expect(source).toContain('storage-git__confirmation')
    expect(source).toContain('remoteInputRef.current?.focus()')
    expect(source).toContain('pendingGitOpenerRef')
    expect(source).toContain('gitConfirmRef')
    expect(source).toContain('queueMicrotask(restoreGitFocus)')
    expect(source).toContain('ref={gitConfirmRef}')
    expect(html).toContain('aria-describedby=')
    expect(source).toContain('aria-invalid={!!remoteUrlError}')
    expect(source.match(/disabled=\{disabled \|\| gitLoading \|\| !!pendingGitMode\}/g)).toHaveLength(3)
  })

  it('renders Windows volume paths without mixed separators', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Windows', parentPath: 'C:\\Data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)

    expect(html).toContain('C:\\Data\\manta-ai-data')
    expect(html).not.toContain('C:\\Data/manta-ai-data')
  })

  it('normalizes a trailing UNC separator without introducing POSIX separators', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Network', parentPath: '\\\\server\\share\\', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)

    expect(html).toContain('\\\\server\\share\\manta-ai-data')
    expect(html).not.toContain('\\\\server\\share/manta-ai-data')
  })

  it('preserves a trailing backslash that is part of a POSIX directory name', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'POSIX', parentPath: '/data/team\\', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)

    expect(html).toContain('/data/team\\/manta-ai-data')
  })

  it('renders an accessible high-risk secrets control with the Git history warning', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'local', includeSecrets: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onRequestGitSecretsGrant={async () => 'opaque'} onSetGitSecretsPolicy={async () => {}} />)
    expect(html).toContain('Sync secrets to Git')
    expect(html).toMatch(/Git history.*hard to erase/i)
    expect(html).toMatch(/private.*not.*absolute safety/i)
    expect(html).toContain('type="checkbox"')
  })

  it('explains that an existing Git binding cannot be changed from this volume card', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'local', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onConfigureGit={() => {}} />)
    expect(html).toContain('already bound to local Git')
    expect(html).not.toContain('Configure local Git')
    expect(html).not.toContain('Configure remote Git')
  })

  it('exposes remote import planning but keeps the decision controls hidden until a plan is fetched', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onPlanImport={async () => ({ volumeId: 'volume-1', sessionId: 'session-1', requiresConfirmation: true, groups: [] })} onApplyImport={async () => {}} />)
    expect(html).toContain('Check remote updates')
    expect(html).not.toContain('Apply selected remote changes')

    const source = readFileSync(new URL('./StorageVolumeCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('restoreImportFocusRef')
    expect(source).toContain('!gitLoading && !importPlan && restoreImportFocusRef.current')
    expect(source).toContain('restoreImportFocusRef.current = true')
  })

  it('shows Git unavailability without configuration controls', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: false, reason: 'Git executable was not found' }} onConfigureGit={() => {}} />)
    expect(html).toContain('Git: unavailable')
    expect(html).toContain('Git executable was not found')
    expect(html).not.toContain('Configure local Git')
    expect(html).not.toContain('Configure remote Git')
  })

  it('shows a cloud folder health warning and explains that automatic sync is paused', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'iCloud', parentPath: '/icloud', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} health={{ status: 'conflict', conflicts: ['work/notes (conflicted copy).md'], checkedAt: '2026-07-13T00:00:00.000Z' }} />)
    expect(html).toContain('Automatic sync paused')
    expect(html).toContain('conflicted copy')
  })
})
