import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AuditLogger storage injection', () => {
  it('refuses persistence until an ASH diagnostics path is injected', async () => {
    const module = await import('./AuditLogger')
    expect(() => module.log({ timestamp: new Date().toISOString(), taskId: 't', action: 'read', approved: true, durationMs: 1 })).toThrow(/injected/i)
  })

  it('writes to the injected diagnostics path', async () => {
    const module = await import('./AuditLogger')
    const file = join(mkdtempSync(join(tmpdir(), 'manta-sandbox-audit-')), 'diagnostics', 'audit.log')
    module.configureAuditLogPath(file)
    module.log({ timestamp: new Date().toISOString(), taskId: 't', action: 'read', approved: true, durationMs: 1 })
    expect(readFileSync(file, 'utf8')).toContain('"taskId":"t"')
  })
})
