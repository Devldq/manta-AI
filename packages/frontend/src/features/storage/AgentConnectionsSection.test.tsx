import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentConnectionsView } from './AgentConnectionsSection'

describe('Agent connections presentation', () => {
  const connection: any = { adapters: [{ id: 'codex', displayName: 'Codex', status: 'detected', installations: [{ id: 'codex-user', displayName: 'Codex', nativeRoots: [{ id: 'codex-home', path: '/home/.codex' }] }] }], operations: [] }
  const assets: any = { inventory: { schemaVersion: 1, installationId: 'codex-user', assets: [{ id: 'skill', kind: 'skill', nativePath: '/home/.agents/skills/demo' }, { id: 'instructions', kind: 'instructions', nativePath: '/home/.codex/AGENTS.md' }, { id: 'server', kind: 'mcp-server', nativePath: '/home/.codex/config.toml' }] }, portableAssets: [{ schemaVersion: 1, id: 'portable-skill', kind: 'skill' }, { schemaVersion: 1, id: 'portable-server', kind: 'mcp-server' }] }

  it('shows grouped native/portable assets, secret guidance, and no premature apply', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} reuse={{ scanStatus: 'degraded', evidenceStatus: 'unavailable', portableAssetCount: 2, logicalImmutableBytes: null, uniqueVerifiedObjectBytes: null, verifiedSavedBytes: null }} nativeSelected={new Set()} portableSelected={new Set()} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} />)
    for (const text of ['Agent connections', 'Codex', '/home/.codex', 'Skills', 'Instructions', 'MCP servers', 'Preview import', 'Preview projection', 'environment-variable names', 'OS setup']) expect(html).toContain(text)
    expect(html).not.toContain('Apply approved plan'); expect(html).not.toContain('Savings verified')
  })

  it('shows every preview operation and verified-only savings, then exposes explicit apply and rollback', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} reuse={{ scanStatus: 'complete', evidenceStatus: 'verified', portableAssetCount: 2, logicalImmutableBytes: 20, uniqueVerifiedObjectBytes: 12, verifiedSavedBytes: 8 }} nativeSelected={new Set(['skill'])} portableSelected={new Set(['portable-skill'])} preview={{ planSessionId: 'session-1', kind: 'projection', expiresAt: '2026-07-15T01:00:00.000Z', operations: [{ id: 'create', kind: 'create', rootId: 'user-skills', nativePath: '/home/.agents/skills/demo/SKILL.md', expectedAfterSha256: 'a'.repeat(64) }] }} result={{ operationId: 'operation-1', adapterId: 'codex', installationId: 'codex-user', kind: 'projection', phase: 'committed', status: 'committed', verified: true, completedAt: '2026-07-15T00:00:01.000Z', operationCount: 1 }} busy={false} onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onApply={() => {}} onRollback={() => {}} />)
    for (const text of ['create', '/home/.agents/skills/demo/SKILL.md', 'Apply approved plan', 'Rollback projection', 'Savings verified: 8 bytes', 'Backups are verified']) expect(html).toContain(text)
  })

  it('renders structured progress and an error retry card while disabling mutation controls', () => {
    const html = renderToStaticMarkup(<AgentConnectionsView connection={connection} assets={assets} nativeSelected={new Set(['skill'])} portableSelected={new Set(['portable-skill'])} progress={{ operationId: 'operation-1', phase: 'applying', status: 'running', operationsCompleted: 1, operationsTotal: 3 }} error={new Error('Detection unavailable')} busy onToggleNative={() => {}} onTogglePortable={() => {}} onPreviewImport={() => {}} onPreviewProjection={() => {}} onRetry={() => {}} />)
    expect(html).toContain('Status: error'); expect(html).toContain('applying: 1/3'); expect(html).toContain('Detection unavailable'); expect(html).toContain('Retry'); expect(html).toContain('disabled=""')
    expect(html).toContain('/home/.agents/skills/demo'); expect(html).toContain('portable-skill')
  })
})
