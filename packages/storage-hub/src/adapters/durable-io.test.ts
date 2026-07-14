import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExclusiveClaimDurable, renameDurable, restoreBytesDurable, unlinkDurable, writeJsonDurable, writeNewBytesDurable } from './durable-io'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'ash-adapter-io-')); roots.push(value); return value }

describe('adapter durable IO', () => {
  it('publishes new backups and replacement journals without leaving staging entries', async () => {
    const directory = await root(); const backup = join(directory, 'backup', '0.bin'); const journal = join(directory, 'journal', 'operation.json'); const events: string[] = []
    await writeNewBytesDurable(backup, Buffer.from('prior')); await expect(writeNewBytesDurable(backup, Buffer.from('overwrite'))).rejects.toThrow(); await writeJsonDurable(journal, { phase: 'one' }, (event) => events.push(event)); await writeJsonDurable(journal, { phase: 'two' })
    expect(await readFile(backup, 'utf8')).toBe('prior'); expect(JSON.parse(await readFile(journal, 'utf8'))).toEqual({ phase: 'two' }); expect(await readdir(join(directory, 'backup'))).toEqual(['0.bin']); expect(await readdir(join(directory, 'journal'))).toEqual(['operation.json'])
    expect(events.slice(0, 2)).toEqual(['staging-file-fsynced', 'atomic-rename-complete']); expect(events[2]).toMatch(/^parent-directory-(?:fsynced|fsync-unsupported)$/)
  })

  it('never truncates the live target when the final path revalidation fails before atomic rename', async () => {
    const directory = await root(); const target = join(directory, 'native.txt'); await writeFile(target, 'current'); let validations = 0
    await expect(restoreBytesDurable(target, Buffer.from('prior'), async () => { validations += 1; if (validations === 2) throw new Error('path changed') })).rejects.toThrow('path changed')
    expect(await readFile(target, 'utf8')).toBe('current'); expect(await readdir(directory)).toEqual(['native.txt'])
  })

  it('exclusively claims, durably quarantines, and durably removes a create target', async () => {
    const directory = await root(); const target = join(directory, 'created'); const quarantine = join(directory, '.quarantine'); const identity = await createExclusiveClaimDurable(target, Buffer.from('nonce'))
    expect(identity).toMatch(/^[a-f0-9-]+$/); await expect(createExclusiveClaimDurable(target, Buffer.from('other'))).rejects.toThrow(); await writeFile(target, 'created'); await renameDurable(target, quarantine)
    await expect(access(target)).rejects.toThrow(); expect(await readFile(quarantine, 'utf8')).toBe('created'); await unlinkDurable(quarantine); await expect(access(quarantine)).rejects.toThrow()
  })
})
