import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { inventoryTree } from './file-inventory'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('reports allocation only with explicit platform evidence and never substitutes logical length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ash-allocation-')); roots.push(root); await writeFile(join(root, 'file'), 'contents')
  const entry = (await inventoryTree(root)).entries.find((item) => item.relativePath === 'file')!
  if (process.platform === 'win32') {
    expect(entry.allocatedBytes).toBeUndefined(); expect(entry.allocationEvidence).toBe('unavailable')
  } else {
    expect(entry.allocatedBytes).toBeTypeOf('number'); expect(entry.allocationEvidence).toBe('posix-blocks')
  }
})
