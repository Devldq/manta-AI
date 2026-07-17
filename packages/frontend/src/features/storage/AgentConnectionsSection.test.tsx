import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentConnectionsView } from './AgentConnectionsSection'

describe('Agent connections presentation', () => {
  const connection: any = { adapters: [{ id: 'codex', displayName: 'Codex', status: 'detected', installations: [{ id: 'codex-user', displayName: 'Codex', nativeRoots: [{ id: 'codex-home', path: '/home/.codex' }] }] }], operations: [] }
  const assets: any = { inventory: { schemaVersion: 1, installationId: 'codex-user', assets: [{ id: 'skill', kind: 'skill', nativePath: '/home/.agents/skills/demo' }, { id: 'instructions', kind: 'instructions', nativePath: '/home/.codex/AGENTS.md' }, { id: 'server', kind: 'mcp-server', nativePath: '/home/.codex/config.toml' }] }, portableAssets: [{ schemaVersion: 1, id: 'portable-skill', kind: 'skill' }, { schemaVersion: 1, id: 'portable-server', kind: 'mcp-server' }] }

  it('keeps inventories behind a closed disclosure while showing compact counts', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} reuse={{ scanStatus: 'degraded', evidenceStatus: 'unavailable', portableAssetCount: 2, logicalImmutableBytes: null, uniqueVerifiedObjectBytes: null, verifiedSavedBytes: null }} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} />)
    for (const text of ['Agent connections', 'Codex', '/home/.codex', 'Skills', 'Instructions', 'MCP servers', 'Preview import', 'Preview projection', 'environment-variable names', 'OS setup']) expect(html).toContain(text)
    for (const className of ['storage-agent', 'storage-button', 'storage-status', 'storage-control']) expect(html).toContain(className)
    expect(html).toContain('<details class="storage-agent__details">')
    expect(html).not.toContain('<details class="storage-agent__details" open')
    expect(html).toContain('3 native')
    expect(html).toContain('2 portable')
    expect(html.match(/3 native · 2 portable/g)).toHaveLength(1)
    expect(html).toContain('View details')
    expect(html.match(/Codex/g)).toHaveLength(1)
    expect(html).not.toContain('Apply approved plan'); expect(html).not.toContain('Savings verified')

    const source = readFileSync(new URL('./AgentConnectionsSection.tsx', import.meta.url), 'utf8')
    expect(source).toContain('open={detailsOpen}')
    expect(source).toContain('onToggle={(event) => setDetailsOpen(event.currentTarget.open)}')
    expect(source).toContain('detailsSummaryRef')
    expect(source).toContain('restoreActionFocusRef')
    expect(source).toContain('ref={detailsSummaryRef}')
    expect(source).toContain("useRef<'apply' | 'rollback' | undefined>(undefined)")
    expect(source).toContain("restoreActionFocusRef.current === 'apply'")
    expect(source).toContain("restoreActionFocusRef.current = 'apply'")
    expect(source).toContain("restoreActionFocusRef.current = 'rollback'")
    expect(source).toContain('ChevronDown')
    expect(source).toContain('storage-agent__details-chevron')
  })

  it('shows every preview operation and verified-only savings, then exposes explicit apply and rollback', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} reuse={{ scanStatus: 'complete', evidenceStatus: 'verified', portableAssetCount: 2, logicalImmutableBytes: 20, uniqueVerifiedObjectBytes: 12, verifiedSavedBytes: 8 }} nativeSelected={new Set(['skill'])} portableSelected={new Set(['portable-skill'])} preview={{ planSessionId: 'session-1', kind: 'projection', expiresAt: '2026-07-15T01:00:00.000Z', operations: [{ id: 'create', kind: 'create', rootId: 'user-skills', nativePath: '/home/.agents/skills/demo/SKILL.md', expectedAfterSha256: 'a'.repeat(64) }] }} result={{ operationId: 'operation-1', adapterId: 'codex', installationId: 'codex-user', kind: 'projection', phase: 'committed', status: 'committed', verified: true, completedAt: '2026-07-15T00:00:01.000Z', operationCount: 1 }} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onApply={() => {}} onRollback={() => {}} />)
    for (const text of ['create', '/home/.agents/skills/demo/SKILL.md', 'Apply approved plan', 'Rollback projection', 'Savings verified: 8 B', 'Backups are verified']) expect(html).toContain(text)
    expect(html).toContain('storage-table')
    expect(html).toContain('role="region"')
    expect(html).not.toContain('role="dialog"')
    expect(html).toContain(`<code>${'a'.repeat(64)}</code>`)
  })

  it('renders structured progress and an error retry card while disabling mutation controls', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} nativeSelected={new Set(['skill'])} portableSelected={new Set(['portable-skill'])} progress={{ operationId: 'operation-1', phase: 'applying', status: 'running', operationsCompleted: 1, operationsTotal: 3 }} error={new Error('Detection unavailable')} busy onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onRetry={() => {}} />)
    expect(html).toContain('Status: error'); expect(html).toContain('Applying: 1/3'); expect(html).toContain('Detection unavailable'); expect(html).toContain('Retry'); expect(html).toContain('disabled=""')
    expect(html).toContain('/home/.agents/skills/demo'); expect(html).toContain('portable-skill')
  })

  it('restores a durable running operation after the Storage view remounts', () => {
    const remountedConnection: any = {
      ...connection,
      operations: [{
        operationId: 'operation-running',
        adapterId: 'codex',
        installationId: 'codex-user',
        kind: 'projection',
        phase: 'applying',
        status: 'running',
        verified: false,
        startedAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:01.000Z',
        operationCount: 3,
      }],
    }

    const html = renderToStaticMarkup(<AgentConnectionsView connection={remountedConnection} assets={assets} nativeSelected={new Set(['skill'])} portableSelected={new Set(['portable-skill'])} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} />)

    expect(html).toContain('Applying: 3 planned changes')
    expect(html).toContain('disabled=""')
  })

  it('restores rollback for the latest durable committed projection after remount', () => {
    const remountedConnection: any = {
      ...connection,
      operations: [{
        operationId: 'operation-committed',
        adapterId: 'codex',
        installationId: 'codex-user',
        kind: 'projection',
        phase: 'committed',
        status: 'committed',
        verified: true,
        startedAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:01.000Z',
        operationCount: 2,
      }],
    }

    const html = renderToStaticMarkup(<AgentConnectionsView connection={remountedConnection} assets={assets} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onRollback={() => {}} />)

    expect(html).toContain('Operation committed and verified.')
    expect(html).toContain('Rollback projection')
  })

  it('renders a truthful scanning state before detection completes', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView loading connection={{ adapters: [], operations: [] }} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} />)
    expect(html).toContain('Scanning Agent connections')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('Not detected')
  })

  it('keeps an initial detection failure visible and retryable without a synthetic adapter', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={{ adapters: [], operations: [] }} error={new Error('Agent detection failed')} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onRetry={() => {}} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Agent detection failed')
    expect(html).toContain('Retry')
  })

  it('filters empty asset groups and explains truly empty columns compactly', () => {
    const emptyAssets: any = { inventory: { schemaVersion: 1, installationId: 'codex-user', assets: [] }, portableAssets: [] }
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={emptyAssets} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} />)
    expect(html).not.toContain('<fieldset')
    expect(html).toContain('No native assets found.')
    expect(html).toContain('No portable assets found.')
  })
})
