import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ADAPTER_SCHEMA_VERSION, AdapterRegistry, CodexAdapter } from '../index'

describe('adapter public contract', () => {
  it('is exported from storage-hub without execution-model concepts', async () => {
    expect(ADAPTER_SCHEMA_VERSION).toBe(1)
    expect(new AdapterRegistry().list()).toEqual([])
    const source = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/codex|harness|model execution/i)
    expect(source).toMatch(/trusted first-party built-in/i)
  })

  it('exports the first-party Codex adapter without Harness concepts', async () => {
    expect(typeof CodexAdapter).toBe('function')
    const source = await readFile(new URL('./codex/index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\bharness\b|model execution/i)
  })
})
