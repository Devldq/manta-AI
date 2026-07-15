import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExclusiveClaimDurable, ensureDirectoryDurable, renameDurable, restoreBytesDurable, unlinkDurable, writeJsonDurable, writeNewBytesDurable } from './durable-io'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-adapter-io-')); roots.push(value); return value }

describe('adapter durable IO', () => {
  it('trusts system link prefixes above an authorized root but rejects links inside it', async () => {
    const directory = await root(); const physical = join(directory, 'physical'); const alias = join(directory, 'alias'); const trusted = join(alias, 'trusted')
    await mkdir(join(physical, 'trusted'), { recursive: true }); await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(ensureDirectoryDurable(join(trusted, 'nested'), trusted)).resolves.toBeUndefined()

    const outside = join(directory, 'outside'); await mkdir(outside); await symlink(outside, join(trusted, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(ensureDirectoryDurable(join(trusted, 'linked', 'nested'), trusted)).rejects.toThrow(/link/i)
  })

  it('publishes new backups and replacement journals without leaving staging entries', async () => {
    const directory = await root(); const backup = join(directory, 'backup', '0.bin'); const journal = join(directory, 'journal', 'operation.json'); const events: string[] = []
    await writeNewBytesDurable(backup, Buffer.from('prior'), directory); await expect(writeNewBytesDurable(backup, Buffer.from('overwrite'), directory)).rejects.toThrow(); await writeJsonDurable(journal, { phase: 'one' }, directory, (event) => events.push(event)); await writeJsonDurable(journal, { phase: 'two' }, directory)
    expect(await readFile(backup, 'utf8')).toBe('prior'); expect(JSON.parse(await readFile(journal, 'utf8'))).toEqual({ phase: 'two' }); expect(await readdir(join(directory, 'backup'))).toEqual(['0.bin']); expect(await readdir(join(directory, 'journal'))).toEqual(['operation.json'])
    expect(events.slice(0, 2)).toEqual(['staging-file-fsynced', 'atomic-rename-complete']); expect(events[2]).toMatch(/^parent-directory-(?:fsynced|fsync-unsupported)$/)
  })

  it('never truncates the live target when the final path revalidation fails before atomic rename', async () => {
    const directory = await root(); const target = join(directory, 'native.txt'); await writeFile(target, 'current'); let validations = 0
    await expect(restoreBytesDurable(target, Buffer.from('prior'), directory, async () => { validations += 1; if (validations === 2) throw new Error('path changed') })).rejects.toThrow('path changed')
    expect(await readFile(target, 'utf8')).toBe('current'); expect(await readdir(directory)).toEqual(['native.txt'])
  })

  it('exclusively claims, durably quarantines, and durably removes a create target', async () => {
    const directory = await root(); const target = join(directory, 'created'); const quarantine = join(directory, '.quarantine'); const identity = await createExclusiveClaimDurable(target, Buffer.from('nonce'))
    expect(identity).toMatch(/^[a-f0-9-]+$/); await expect(createExclusiveClaimDurable(target, Buffer.from('other'))).rejects.toThrow(); await writeFile(target, 'created'); await renameDurable(target, quarantine)
    await expect(access(target)).rejects.toThrow(); expect(await readFile(quarantine, 'utf8')).toBe('created'); await unlinkDurable(quarantine); await expect(access(quarantine)).rejects.toThrow()
  })
})
