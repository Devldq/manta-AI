import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { acquireMigrationFileLock } from './migration-lock'

describe('migration file lock', () => {
  it('publishes only a complete owner and never grants two holders during the publish race', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); let entered!: () => void; let resume!: () => void
    const atWindow = new Promise<void>((resolve) => { entered = resolve }); const gate = new Promise<void>((resolve) => { resume = resolve })
    const acquiring = acquireMigrationFileLock(bootstrap, { afterCreate: async () => { entered(); await gate } }); await atWindow
    await expect(access(`${bootstrap}.migration.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    const competing = await acquireMigrationFileLock(bootstrap, { breakStale: true })
    expect(JSON.parse(await readFile(`${bootstrap}.migration.lock`, 'utf8'))).toMatchObject({ pid: process.pid })
    resume()
    await expect(acquiring).rejects.toThrow(/already held/i)
    await competing.release()
    expect((await readdir(root)).filter((name) => name.includes('.candidate-'))).toEqual([])
  })

  it('fails closed for an unknown owner because no valid publisher can create one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-unknown-')); const bootstrap = join(root, 'bootstrap.json')
    await writeFile(`${bootstrap}.migration.lock`, '')
    await expect(acquireMigrationFileLock(bootstrap, { breakStale: true })).rejects.toThrow(/unknown.*owner/i)
  })

  it('falls back portably when hard links are unsupported without allowing a second holder through the unknown-owner window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-fallback-')); const bootstrap = join(root, 'bootstrap.json'); const lockPath = `${bootstrap}.migration.lock`
    let entered!: () => void; let resume!: () => void
    const atWindow = new Promise<void>((resolve) => { entered = resolve }); const gate = new Promise<void>((resolve) => { resume = resolve })
    const publishLink = vi.fn(async () => { throw Object.assign(new Error('hard links unsupported'), { code: 'EOPNOTSUPP' }) })
    const acquiring = acquireMigrationFileLock(bootstrap, { publishLink, afterFallbackCreate: async () => { entered(); await gate } })
    const reachedWindow = await Promise.race([atWindow.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 50))])

    expect(reachedWindow).toBe(true)
    await expect(access(lockPath)).resolves.toBeUndefined()
    await expect(readFile(lockPath, 'utf8')).resolves.toBe('')
    await expect(acquireMigrationFileLock(bootstrap, { breakStale: true })).rejects.toMatchObject({ code: 'UNKNOWN_OWNER' })

    resume()
    const lock = await acquiring
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ pid: process.pid })
    await lock.release()
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(publishLink).toHaveBeenCalledTimes(1)
  })

  it('preserves an unexpected hard-link publication error instead of reporting lock contention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-link-error-')); const bootstrap = join(root, 'bootstrap.json')
    const failure = Object.assign(new Error('link I/O failure'), { code: 'EIO' })

    await expect(acquireMigrationFileLock(bootstrap, { publishLink: async () => { throw failure } })).rejects.toBe(failure)
  })

  it('cleans its exclusive portable canonical when publication fails before owner sync', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-fallback-error-')); const bootstrap = join(root, 'bootstrap.json'); const lockPath = `${bootstrap}.migration.lock`
    const failure = new Error('injected fallback write failure')

    await expect(acquireMigrationFileLock(bootstrap, {
      publishLink: async () => { throw Object.assign(new Error('hard links unsupported'), { code: 'EOPNOTSUPP' }) },
      afterFallbackCreate: async () => { throw failure },
    })).rejects.toBe(failure)

    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('an old owner release does not remove a replacement token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-lock-')); const bootstrap = join(root, 'bootstrap.json'); const path = `${bootstrap}.migration.lock`; const old = await acquireMigrationFileLock(bootstrap)
    await writeFile(path, JSON.stringify({ token: 'replacement', pid: process.pid, processIdentity: 'replacement-process', createdAt: new Date().toISOString() })); await old.release()
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
