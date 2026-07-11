import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inventoryTree } from './file-inventory'

describe('inventoryTree', () => {
  it('records stable file metadata and does not follow symbolic links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-inventory-'))
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'data.txt'), 'hello')
    await symlink(join(root, 'nested'), join(root, 'linked'), 'junction')
    const inventory = await inventoryTree(root)
    expect(inventory.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'nested/data.txt', kind: 'file', size: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }),
      expect.objectContaining({ relativePath: 'linked', kind: 'symlink', linkTarget: expect.stringContaining(join(root, 'nested')) }),
    ]))
    expect(inventory.entries.filter((entry) => entry.relativePath.includes('linked/'))).toEqual([])
  })

  it('classifies file and directory links so copy can recreate their type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-links-')); await mkdir(join(root, 'dir')); await writeFile(join(root, 'file'), 'x')
    try { await symlink(join(root, 'file'), join(root, 'file-link'), 'file'); await symlink(join(root, 'dir'), join(root, 'dir-link'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    const entries = (await inventoryTree(root)).entries
    expect(entries.find((entry) => entry.relativePath === 'file-link')?.linkType).toBe('file')
    expect(entries.find((entry) => entry.relativePath === 'dir-link')?.linkType).toMatch(/directory|junction/)
  })
})
