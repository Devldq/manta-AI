import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireMigrationFileLock } from './migration-lock'

describe('migration file lock', () => {
  it('never breaks an empty lock during its initialization window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); let entered!: () => void; let resume!: () => void
    const atWindow = new Promise<void>((resolve) => { entered = resolve }); const gate = new Promise<void>((resolve) => { resume = resolve })
    const acquiring = acquireMigrationFileLock(bootstrap, { afterCreate: async () => { entered(); await gate } }); await atWindow
    await expect(acquireMigrationFileLock(bootstrap, { breakStale: true })).rejects.toThrow(/unknown.*owner/i); resume(); const lock = await acquiring; await lock.release()
  })

  it('an old owner release does not remove a replacement token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); const path = `${bootstrap}.migration.lock`; const old = await acquireMigrationFileLock(bootstrap)
    await writeFile(path, JSON.stringify({ token: 'replacement', pid: process.pid, createdAt: new Date().toISOString() })); await old.release()
    expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('replacement')
  })

  it('recovers a well-formed lock whose owner process is dead', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); await writeFile(`${bootstrap}.migration.lock`, JSON.stringify({ token: 'stale', pid: 2_147_483_647, processIdentity: 'old', createdAt: new Date().toISOString() }))
    const lock = await acquireMigrationFileLock(bootstrap, { breakStale: true }); await lock.release()
  })

  it('cleans a reused pid only when its process start identity differs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); await writeFile(`${bootstrap}.migration.lock`, JSON.stringify({ token: 'stale', pid: process.pid, processIdentity: 'old-start', createdAt: new Date().toISOString() }))
    const lock = await acquireMigrationFileLock(bootstrap, { breakStale: true, inspectProcess: async () => ({ alive: true, identity: 'new-start' }) }); await lock.release()
  })

  it('retains a lock with the same pid and start identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); await writeFile(`${bootstrap}.migration.lock`, JSON.stringify({ token: 'live', pid: process.pid, processIdentity: 'same-start', createdAt: new Date().toISOString() }))
    await expect(acquireMigrationFileLock(bootstrap, { breakStale: true, inspectProcess: async () => ({ alive: true, identity: 'same-start' }) })).rejects.toThrow(/already held/i)
  })

  it('fails closed when process identity cannot be obtained', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); await writeFile(`${bootstrap}.migration.lock`, JSON.stringify({ token: 'unknown', pid: process.pid, processIdentity: 'old-start', createdAt: new Date().toISOString() }))
    await expect(acquireMigrationFileLock(bootstrap, { breakStale: true, inspectProcess: async () => ({ alive: true }) })).rejects.toThrow(/identity.*unavailable/i)
  })
})
