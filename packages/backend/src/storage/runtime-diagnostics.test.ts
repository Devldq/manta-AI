import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeDiagnosticsWriter, sanitizeDiagnosticEntry } from './runtime-diagnostics'

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
  it('redacts sensitive fields and bounds persisted diagnostic payloads', () => {
    const entry = sanitizeDiagnosticEntry({
      id: 'safe-entry',
      timestamp: new Date().toISOString(),
      type: 'model_output',
      message: 'Bearer secret-bearer-value',
      metadata: {
        conversationId: 'conversation-1',
        prompt: 'private user prompt',
        systemContent: 'full system prompt',
        usage: { inputTokens: 12, outputTokens: 3 },
      },
      details: {
        text: 'private model output',
        textLength: 20,
        apiKey: 'sk-super-secret-value',
        input: { path: '/private/customer-record.txt', content: 'private customer record' },
        output: { result: 'private tool output' },
        oversized: 'x'.repeat(100_000),
      },
    })

    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('private user prompt')
    expect(serialized).not.toContain('full system prompt')
    expect(serialized).not.toContain('private model output')
    expect(serialized).not.toContain('private customer record')
    expect(serialized).not.toContain('private tool output')
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('secret-bearer-value')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('[OMITTED: model output content]')
    expect(serialized).toContain('"inputTokens":12')
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(32 * 1024)

    const bounded = sanitizeDiagnosticEntry({
      id: 'bounded-entry',
      timestamp: new Date().toISOString(),
      message: 'bounded',
      metadata: {
        conversationId: 'conversation-1',
        usage: { inputTokens: 12 },
        extra: Array.from({ length: 100 }, () => 'y'.repeat(10_000)),
      },
    })
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(32 * 1024)
    expect(bounded.metadata).toMatchObject({ conversationId: 'conversation-1', usage: { inputTokens: 12 } })
  })

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
