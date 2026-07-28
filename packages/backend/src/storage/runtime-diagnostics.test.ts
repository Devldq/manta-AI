import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsWriter } from './runtime-diagnostics'

const writeGate = vi.hoisted(() => {
  let release!: () => void
  return {
    wait: new Promise<void>((resolve) => { release = resolve }),
    release: () => release(),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      await writeGate.wait
      return actual.appendFile(...args)
    },
  }
})

describe('RuntimeDiagnosticsWriter deferred logs', () => {
  it('does not await a slow diagnostics volume before returning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-deferred-diagnostics-'))
    const writer = new RuntimeDiagnosticsWriter(root)

    expect(writer.appendDeferred({
      id: 'deferred-entry',
      timestamp: new Date().toISOString(),
      metadata: { conversationId: 'conversation-1' },
    })).toBe(true)

    const checkpoint = writer.checkpoint()
    await expect(Promise.race([
      checkpoint.then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still-writing'), 20)),
    ])).resolves.toBe('still-writing')

    writeGate.release()
    await checkpoint

    expect(readFileSync(join(root, 'system.log'), 'utf8')).toContain('deferred-entry')
    expect(readFileSync(join(root, 'conversations', 'conversation-1', 'log.ndjson'), 'utf8')).toContain('deferred-entry')
  })
})
