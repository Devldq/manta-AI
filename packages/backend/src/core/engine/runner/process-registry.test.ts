import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProcessRegistry } from './process-registry'

describe('ProcessRegistry storage lifecycle', () => {
  it('has no import-time singleton and reloads only the migrated root after reopen', async () => {
    const oldRoot = mkdtempSync(join(tmpdir(), 'manta-process-old-'))
    const newRoot = mkdtempSync(join(tmpdir(), 'manta-process-new-'))
    const registry = createProcessRegistry(oldRoot)

    registry.register('old-task', 101, 'old-agent')
    await registry.checkpoint()
    await registry.close()
    expect(existsSync(join(oldRoot, 'processes', 'process-registry.json'))).toBe(true)

    await registry.reopen(newRoot)
    expect(registry.getAllProcesses()).toEqual([])
    registry.register('new-task', 202, 'new-agent')
    await registry.checkpoint()

    expect(readFileSync(join(newRoot, 'processes', 'process-registry.json'), 'utf8')).toContain('new-task')
    expect(readFileSync(join(oldRoot, 'processes', 'process-registry.json'), 'utf8')).not.toContain('new-task')
  })

  it('reports integrity and rejects writes while closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-process-lifecycle-'))
    const registry = createProcessRegistry(root)
    await registry.close()
    expect(() => registry.register('late', 1, 'agent')).toThrow(/closed/i)
    expect((await registry.integrityCheck()).ok).toBe(true)
  })
})
