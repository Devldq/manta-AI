import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inventoryTree } from './file-inventory'
import { inspectWindowsLinks } from './windows-link-type'

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
    expect(entries.find((entry) => entry.relativePath === 'dir-link')?.linkType).toBe(process.platform === 'win32' ? 'junction' : 'directory')
  })

  it.runIf(process.platform === 'win32')('distinguishes a directory symlink from a junction when privileges allow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-dir-link-')); await mkdir(join(root, 'dir'))
    try { await symlink(`${join(root, 'dir')}\\`, join(root, 'dir-link'), 'dir') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    expect((await inventoryTree(root)).entries.find((entry) => entry.relativePath === 'dir-link')?.linkType).toBe('directory')
  })

  it('classifies hundreds of Windows links in bounded chunks with stable ids', async () => {
    const calls: string[] = []; const links = Array.from({ length: 500 }, (_, index) => ({ id: `link-${index}`, path: `C:\\links\\${index}` }))
    const result = await inspectWindowsLinks(links, { chunkSize: 200, run: async (_script, input) => { calls.push(input); const rows = JSON.parse(input) as typeof links; return JSON.stringify(rows.map((row, index) => ({ id: row.id, linkType: index % 2 ? 'SymbolicLink' : 'Junction', isContainer: true }))) } })
    expect(calls).toHaveLength(3); expect(result.get('link-0')).toEqual({ linkType: 'Junction', isContainer: true }); expect(result.get('link-201')).toEqual({ linkType: 'SymbolicLink', isContainer: true })
  })

  it.runIf(process.platform === 'win32')('round-trips non-ASCII paths and stable ids through real PowerShell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-中文-😀-')); const target = join(root, '目录-😀'); const link = join(root, '链接-😀'); await mkdir(target); await symlink(target, link, 'junction')
    const id = '相对/链接-😀'; const result = await inspectWindowsLinks([{ id, path: link }]); expect(result.get(id)).toEqual({ linkType: 'Junction', isContainer: true })
  })
})
