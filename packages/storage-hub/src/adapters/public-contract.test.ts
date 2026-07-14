import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ADAPTER_SCHEMA_VERSION, AdapterRegistry } from '../index'

describe('adapter public contract', () => {
  it('is exported from storage-hub without execution-model concepts', async () => {
    expect(ADAPTER_SCHEMA_VERSION).toBe(1)
    expect(new AdapterRegistry().list()).toEqual([])
    const source = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/codex|harness|model execution/i)
    expect(source).toMatch(/trusted first-party built-in/i)
  })
})
