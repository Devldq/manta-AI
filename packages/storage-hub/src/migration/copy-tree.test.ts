import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inventoryTree } from '../inventory/file-inventory'
import { copyTree } from './copy-tree'

describe('copyTree links', () => {
  it('recreates links from captured inventory even after the source target disappears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-copy-links-')); const source = join(root, 'source'); const target = join(root, 'target'); await mkdir(source); await writeFile(join(source, 'payload'), 'x')
    try { await symlink('payload', join(source, 'link'), 'file') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    const inventory = await inventoryTree(source); await writeFile(join(source, 'payload'), 'changed'); await copyTree(source, target, { ...inventory, entries: inventory.entries.filter((entry) => entry.relativePath === 'link'), files: 0, bytes: 0 })
    expect((await lstat(join(target, 'link'))).isSymbolicLink()).toBe(true); expect(await readlink(join(target, 'link'))).toBe('payload')
  })

  it.runIf(process.platform === 'win32')('recreates a captured junction after its target becomes unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-copy-junction-')); const source = join(root, 'source'); const target = join(root, 'target'); const payload = join(root, 'payload'); await mkdir(source); await mkdir(payload); await symlink(payload, join(source, 'junction'), 'junction')
    const captured = await inventoryTree(source); const entry = captured.entries.find((item) => item.relativePath === 'junction')!; expect(entry.linkType).toBe('junction'); await rm(payload, { recursive: true })
    await copyTree(source, target, { root: source, entries: [entry], files: 0, bytes: 0 }); expect((await lstat(join(target, 'junction'))).isSymbolicLink()).toBe(true); expect(await readlink(join(target, 'junction'))).toContain('payload')
  })
})
