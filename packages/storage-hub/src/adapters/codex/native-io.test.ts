import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readOrdinaryNoFollow, withOrdinaryNoFollowWritable } from './native-io'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'ash-codex-io-')); roots.push(root); return root }
const identity = async (path: string) => { const stat = await lstat(path, { bigint: true }); return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` }

it('rejects a linked native entry and writes an ordinary claim through one stable handle', async () => {
  const root = await temporary(); const outside = join(root, 'outside'); await mkdir(outside); const linked = join(root, 'linked'); await symlink(outside, linked, 'junction'); await expect(readOrdinaryNoFollow(linked)).rejects.toThrow(/ordinary|link|directory/i)
  const claim = join(root, 'claim'); await writeFile(claim, 'nonce'); const before = await identity(claim); await withOrdinaryNoFollowWritable(claim, async (handle) => { await handle.truncate(0); await handle.writeFile('portable') }); expect(await identity(claim)).toBe(before); expect(await readFile(claim, 'utf8')).toBe('portable')
})
