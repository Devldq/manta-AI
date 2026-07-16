import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StorageOverview } from './StorageOverview'
import { StorageGroupRow } from './StorageGroupRow'
import { StorageOperationDialog } from './StorageOperationDialog'
import { StorageVolumeCard } from './StorageVolumeCard'

describe('storage settings presentation', () => {
  it('puts the active volume path and controls before group and Agent details', () => {
    const source = readFileSync(new URL('./StorageSettingsPanel.tsx', import.meta.url), 'utf8')
    const volumes = source.indexOf('>Volumes</h3>')
    expect(volumes).toBeGreaterThan(-1)
    expect(volumes).toBeLessThan(source.indexOf('<StorageOverview'))
    expect(volumes).toBeLessThan(source.indexOf('<AgentConnectionsSection'))
  })

  it('shows verified capacity categories and a savings claim only for a complete scan', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [], capacity: { scanStatus: 'complete', logicalImmutableBytes: 100, physicalImmutableBytes: 60, verifiedDedupSavedBytes: 40, replicaBytes: 9, cleanableBytes: 3, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [] } }} />)
    for (const text of ['Logical immutable: 100 B', 'Physical immutable: 60 B', 'Replica/cache: 9 B', 'Safely cleanable: 3 B', 'Savings verified: 40 B']) expect(html).toContain(text)
  })

  it.each(['degraded', 'scanning'] as const)('never renders a numeric savings claim for %s capacity', (scanStatus) => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [], capacity: { scanStatus, logicalImmutableBytes: 100, physicalImmutableBytes: null, verifiedDedupSavedBytes: null, replicaBytes: 9, cleanableBytes: null, scannedAt: '2026-07-14T00:00:00.000Z', blockers: [{ code: 'allocation-unavailable', detail: 'Allocation evidence unavailable' }] } }} />)
    expect(html).not.toContain('Savings verified'); expect(html).not.toContain('Savings: 0'); expect(html).toContain(scanStatus === 'scanning' ? 'Capacity scan pending' : 'Capacity unavailable'); expect(html).toContain('Allocation evidence unavailable')
  })

  it('renders all seven ASH storage groups with their user-facing descriptions and health', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [] }} />)
    for (const group of ['Extensions', 'Knowledge', 'Work data', 'Configuration', 'Secrets', 'Diagnostics', 'Cache']) expect(html).toContain(group)
    expect(html).toContain('Not assigned')
  })

  it('renders group inventory and a move control instead of exposing filesystem controls', () => {
    const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '/private/manta-ai-data/knowledge', bytes: 1024, files: 2, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]} onMove={() => {}} disabled={false} />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('1 KB')
    expect(html).toContain('Move group')
    expect(html).not.toContain('input type="file"')
  })

  it('renders storage confirmations as a fixed overlay instead of below the scrollable settings content', () => {
    const html = renderToStaticMarkup(<StorageOperationDialog open title="Create storage volume" body="Choose a parent folder." confirmLabel="Confirm and continue" busy={false} onCancel={() => {}} onConfirm={async () => {}} />)

    expect(html).toContain('data-storage-operation-overlay="true"')
    expect(html).toContain('position:fixed')
    expect(html).toContain('inset:0')
    expect(html).toContain('z-index:10000')
    expect(html).toContain('aria-modal="true"')
  })

  it('shows Git binding state and exposes local and remote configuration without secret inputs', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onConfigureGit={() => {}} />)
    expect(html).toContain('Git: remote')
    expect(html).toContain('/private/manta-ai-data')
    expect(html).not.toContain('/private/.manta-ai')
    expect(html).toContain('https://example.test/ash.git')
    expect(html).toContain('Configure local Git')
    expect(html).toContain('Configure remote Git')
    expect(html).not.toContain('password')
    expect(html).not.toContain('token')
  })

  it('renders Windows volume paths without mixed separators', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Windows', parentPath: 'C:\\Data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} />)

    expect(html).toContain('C:\\Data\\manta-ai-data')
    expect(html).not.toContain('C:\\Data/manta-ai-data')
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
  })

  it('exposes remote import planning but keeps the decision controls hidden until a plan is fetched', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onPlanImport={async () => ({ volumeId: 'volume-1', sessionId: 'session-1', requiresConfirmation: true, groups: [] })} onApplyImport={async () => {}} />)
    expect(html).toContain('Check remote updates')
    expect(html).not.toContain('Apply selected remote changes')
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
