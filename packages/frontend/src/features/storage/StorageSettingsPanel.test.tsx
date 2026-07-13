import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StorageOverview } from './StorageOverview'
import { StorageGroupRow } from './StorageGroupRow'
import { StorageVolumeCard } from './StorageVolumeCard'

describe('storage settings presentation', () => {
  it('renders all seven ASH storage groups with their user-facing descriptions and health', () => {
    const html = renderToStaticMarkup(<StorageOverview overview={{ volumes: [], groups: [] }} />)
    for (const group of ['Extensions', 'Knowledge', 'Work data', 'Configuration', 'Secrets', 'Diagnostics', 'Cache']) expect(html).toContain(group)
    expect(html).toContain('Not assigned')
  })

  it('renders group inventory and a move control instead of exposing filesystem controls', () => {
    const html = renderToStaticMarkup(<StorageGroupRow group={{ id: 'knowledge', volumeId: 'volume-1', path: '/private/.manta-ai/knowledge', bytes: 1024, files: 2, health: 'healthy' }} volumes={[{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]} onMove={() => {}} disabled={false} />)
    expect(html).toContain('Knowledge')
    expect(html).toContain('1 KB')
    expect(html).toContain('Move group')
    expect(html).not.toContain('input type="file"')
  })

  it('shows Git binding state and exposes local and remote configuration without secret inputs', () => {
    const html = renderToStaticMarkup(<StorageVolumeCard volume={{ id: 'volume-1', name: 'Private', parentPath: '/private', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }} disabled={false} onOpen={() => {}} onRelocate={() => {}} git={{ available: true, binding: { volumeId: 'volume-1', mode: 'remote', remoteUrl: 'https://example.test/ash.git', credentialRef: 'keychain:work', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }} onConfigureGit={() => {}} />)
    expect(html).toContain('Git: remote')
    expect(html).toContain('https://example.test/ash.git')
    expect(html).toContain('Configure local Git')
    expect(html).toContain('Configure remote Git')
    expect(html).not.toContain('password')
    expect(html).not.toContain('token')
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
})
