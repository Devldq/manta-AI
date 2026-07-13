import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeCredentialStore, GitBindingStore, GitRunner, GitSyncService, redactGitText } from './index'
import { StorageLeaseManager } from '../../runtime/lease-manager'
import { planGroupConflicts } from '../conflict-planner'

const directories: string[] = []

async function directory(): Promise<string> {
  const result = await mkdtemp(path.join(tmpdir(), 'ash-git-'))
  directories.push(result)
  return result
}

// Git may release nested metadata handles a moment after a child process exits on Windows.
// Retry only disposable test directories so root-level parallel test runs cannot flake on ENOTEMPTY.
afterEach(async () => { await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))) })

describe('GitRunner', () => {
  it('discovers an installed Git version and runs without a shell or interactive prompts', async () => {
    const calls: Array<{ file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = []
    const runner = new GitRunner({
      execFile: async (file, args, options) => { calls.push({ file, args, env: options.env }); return { stdout: 'git version 2.45.1\n', stderr: '' } },
      binary: 'git',
    })

    await expect(runner.capability()).resolves.toEqual({ available: true, version: '2.45.1' })
    await runner.exec(['status', '--porcelain'], { cwd: '/tmp/repository' })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ file: 'git', args: ['status', '--porcelain'] })
    expect(calls[1].env?.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('returns an unavailable capability when Git cannot be executed', async () => {
    const runner = new GitRunner({ execFile: async () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) } })
    await expect(runner.capability()).resolves.toEqual({ available: false, reason: 'Git executable was not found' })
  })

  it('redacts credentials from Git errors', async () => {
    const runner = new GitRunner({ execFile: async () => { throw new Error('https://alice:token_12345678901234567890@example.test/repo denied') } })
    await expect(runner.exec(['ls-remote', 'https://example.test/repo'])).rejects.not.toThrow('token_12345678901234567890')
    expect(redactGitText('Bearer ghp_123456789012345678901234567890123456')).not.toContain('ghp_')
    expect(redactGitText('fatal: https://example.test/repo?access_token=secret-value denied')).not.toContain('secret-value')
    expect(redactGitText('fatal: token_12345678901234567890 denied')).not.toContain('token_12345678901234567890')
  })
})

describe('GitSyncService import authorization', () => {
  it('rejects forged, omitted, and disallowed IPC decisions before the importer sees them', async () => {
    const root = await directory(); const applied: unknown[] = []
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: { resolveVolumeRoot: () => root }, cachePath: () => `${root}.cache`, importer: { apply: async (value: unknown) => { applied.push(value) } } as any })
    const plan = planGroupConflicts({ base: { work: 'a'.repeat(64), knowledge: 'a'.repeat(64) }, local: { work: 'a'.repeat(64), knowledge: 'b'.repeat(64) }, remote: { work: 'c'.repeat(64), knowledge: 'c'.repeat(64) } })
    ;(service as any).imports.set('opaque', { volumeId: 'primary', stagingRoot: path.join(root, 'staging'), manifest: { schemaVersion: 1, volumeId: 'primary', generation: 1, groupHashes: { work: 'c'.repeat(64), knowledge: 'c'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, plan, localHashes: { work: 'a'.repeat(64), knowledge: 'b'.repeat(64) }, allowedChoices: new Map(plan.groups.map(({ group, choices }) => [group, new Set(choices)])) })
    await expect(service.applyRemoteImport('primary', { sessionId: 'opaque', decisions: { config: 'keep-remote' } })).rejects.toThrow(/not offered/i)
    expect(applied).toEqual([])
    // Invalid renderer input does not reach the privileged importer.
    expect((service as any).imports.has('opaque')).toBe(true)

    ;(service as any).imports.set('opaque-2', { volumeId: 'primary', stagingRoot: path.join(root, 'staging'), manifest: { schemaVersion: 1, volumeId: 'primary', generation: 1, groupHashes: { work: 'c'.repeat(64), knowledge: 'c'.repeat(64) }, createdAt: '2026-07-13T00:00:00.000Z' }, plan, localHashes: { work: 'a'.repeat(64), knowledge: 'b'.repeat(64) }, allowedChoices: new Map(plan.groups.map(({ group, choices }) => [group, new Set(choices)])) })
    await expect(service.applyRemoteImport('primary', { sessionId: 'opaque-2', decisions: { work: 'keep-remote' } })).rejects.toThrow(/knowledge.*required/i)
    expect(applied).toEqual([])
  })
})

describe('GitSyncService', () => {
  function resolver(volumeId: string, root: string): { resolveVolumeRoot(id: string): string } {
    return { resolveVolumeRoot(id) { if (id !== volumeId) throw new Error(`Inactive volume ${id}`); return root } }
  }

  function safeCachePath(volumeRoot: string): (volumeId: string) => string {
    const cacheRoot = `${volumeRoot}.cache`
    if (!directories.includes(cacheRoot)) directories.push(cacheRoot)
    return (volumeId) => path.join(cacheRoot, volumeId)
  }

  it('requires an injected cache workspace and never falls back to the active volume', async () => {
    const root = await directory()
    // Simulate an old direct library consumer at runtime. The public type must
    // reject this too, but the runtime guard protects JavaScript consumers.
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) } as never)

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).rejects.toThrow(/cache workspace/i)
    await expect(readFile(path.join(root, '.ash', 'sync', 'git', '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a cache resolver that points its Git workspace at the active volume', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: () => root })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).rejects.toThrow(/active volume/i)
    await expect(readFile(path.join(root, '.ash', 'sync', 'git', '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a Git workspace nested in a syncable group without creating Git data there', async () => {
    const root = await directory()
    const workspace = path.join(root, 'work')
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: () => workspace })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).rejects.toThrow(/syncable storage group/i)
    await expect(readFile(path.join(workspace, '.ash', 'sync', 'git', '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes conflicting concurrent bindings so the catalog and repository remote agree', async () => {
    const root = await directory()
    let releaseSecondBind!: () => void
    const secondBind = new Promise<void>((resolve) => { releaseSecondBind = resolve })
    let bindCalls = 0
    class BarrierBindingStore extends GitBindingStore {
      override async bind(binding: Parameters<GitBindingStore['bind']>[0]) {
        bindCalls += 1
        if (bindCalls === 1) await Promise.race([secondBind, new Promise((resolve) => setTimeout(resolve, 100))])
        else releaseSecondBind()
        return super.bind(binding)
      }
    }
    const bindings = new BarrierBindingStore(path.join(root, 'config'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings, volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    const remoteUrl = 'https://example.test/owner/repository.git'
    const remote = service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const local = service.bindVolume({ volumeId: 'primary', mode: 'local' })
    const outcomes = await Promise.allSettled([remote, local])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => (outcome as PromiseRejectedResult).reason)).toEqual([expect.objectContaining({ code: 'GIT_BINDING_CONFLICT' })])
    const [binding] = await bindings.list()
    expect(binding).toBeDefined()
    const repositoryPath = path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath)
    const configuredRemote = await new GitRunner().exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath }).then((result) => result.stdout.trim()).catch(() => undefined)
    expect(configuredRemote).toBe(binding.mode === 'remote' ? remoteUrl : undefined)
  })

  it('initializes one local repository per volume and writes a safe gitignore', async () => {
    const root = await directory()
    const bindings = new GitBindingStore(path.join(root, 'config'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings, volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    expect(binding).toMatchObject({ volumeId: 'primary', mode: 'local', repositoryRelativePath: path.join('.ash', 'sync', 'git') })
    await expect(readFile(path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath, '.gitignore'), 'utf8')).resolves.toContain('secrets/')
    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).resolves.toEqual(binding)
    await expect(bindings.list()).resolves.toHaveLength(1)
  })

  it('keeps each Git workspace in the injected cache group, outside the synchronized volume', async () => {
    const root = await directory(); const cache = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: (id) => path.join(cache, id) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    const repositoryPath = path.join(cache, 'primary', binding.repositoryRelativePath)
    await expect(new GitRunner().exec(['rev-parse', '--git-dir'], { cwd: repositoryPath })).resolves.toMatchObject({ stdout: expect.any(String) })
    await expect(readFile(path.join(root, binding.repositoryRelativePath, '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rebuilds a cleared cache workspace from its binding without writing Git data into the active volume', async () => {
    const root = await directory(); const cache = await directory(); const leases = new StorageLeaseManager()
    await mkdir(path.join(root, 'work'), { recursive: true }); await writeFile(path.join(root, 'work', 'task.md'), 'safe')
    const cachePath = (id: string) => path.join(cache, id)
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath, snapshots: { generation: () => 1, leases } })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    await rm(cachePath('primary'), { recursive: true, force: true })
    await expect(service.syncVolume('primary')).resolves.toMatchObject({ commit: expect.stringMatching(/^[a-f0-9]{40}$/) })
    await expect(readFile(path.join(cachePath('primary'), binding.repositoryRelativePath, '.git', 'HEAD'), 'utf8')).resolves.toContain('ref:')
    await expect(readFile(path.join(root, binding.repositoryRelativePath, '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // This performs two real bare-repository pushes and a clone. Allow CI's concurrent
  // package builds without weakening the default timeout for ordinary unit tests.
  it('continues pushing a remote snapshot after its disposable cache workspace is removed', async () => {
    const root = await directory(); const cache = await directory(); const remote = await directory(); const real = new GitRunner(); const leases = new StorageLeaseManager()
    await real.exec(['init', '--bare', '--quiet'], { cwd: remote })
    await mkdir(path.join(root, 'work'), { recursive: true }); await writeFile(path.join(root, 'work', 'task.md'), 'first')
    const cachePath = (id: string) => path.join(cache, id)
    const remoteUrl = 'https://example.test/ash.git'
    const commands: Array<{ args: string[]; cwd?: string }> = []
    const runner = new GitRunner({ execFile: async (_binary, args, options) => {
      commands.push({ args: [...args], cwd: options.cwd })
      const rewritten = args[0] === 'remote' && args[1] === 'add' && args[2] === 'origin' && args[3] === remoteUrl
        ? [...args.slice(0, 3), `file://${remote}`]
        : [...args]
      return real.exec(rewritten, { cwd: options.cwd, env: options.env })
    } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath, snapshots: { generation: () => 2, leases } })

    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl })
    await expect(service.syncVolume('primary')).resolves.toMatchObject({ commit: expect.stringMatching(/^[a-f0-9]{40}$/) })
    await rm(cachePath('primary'), { recursive: true, force: true })
    await writeFile(path.join(root, 'work', 'task.md'), 'second')

    await expect(service.syncVolume('primary')).resolves.toMatchObject({ commit: expect.stringMatching(/^[a-f0-9]{40}$/) })
    const clone = await directory(); await real.exec(['clone', '--quiet', `file://${remote}`, clone])
    await expect(readFile(path.join(clone, 'work', 'task.md'), 'utf8')).resolves.toBe('second')
    expect(commands.filter(({ args }) => ['checkout', 'merge', 'reset'].includes(args[0]))).toEqual([])
    expect(commands.filter(({ cwd }) => cwd?.startsWith(root)).map(({ args }) => args[0])).not.toContain('init')
    await expect(readFile(path.join(root, '.ash', 'sync', 'git', '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('fetches a remote manifest only into a disposable cache staging worktree', async () => {
    const root = await directory(); const cache = await directory(); const remote = await directory(); const real = new GitRunner(); const leases = new StorageLeaseManager()
    await real.exec(['init', '--bare', '--quiet'], { cwd: remote })
    await mkdir(path.join(root, 'work'), { recursive: true }); await writeFile(path.join(root, 'work', 'task.md'), 'remote')
    const remoteUrl = 'https://example.test/ash.git'; const cachePath = (id: string) => path.join(cache, id)
    const runner = new GitRunner({ execFile: async (_binary, args, options) => real.exec(args[0] === 'remote' && args[1] === 'add' && args[3] === remoteUrl ? [...args.slice(0, 3), `file://${remote}`] : args, { cwd: options.cwd, env: options.env }) })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath, snapshots: { generation: () => 2, leases } })
    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl }); await service.syncVolume('primary')
    await writeFile(path.join(root, 'work', 'task.md'), 'local unchanged')

    const fetched = await service.fetchRemoteImport('primary')
    expect(fetched.manifest).toMatchObject({ volumeId: 'primary', groupHashes: { work: expect.any(String) } })
    await expect(readFile(path.join(fetched.stagingRoot, 'work', 'task.md'), 'utf8')).resolves.toBe('remote')
    await expect(readFile(path.join(root, 'work', 'task.md'), 'utf8')).resolves.toBe('local unchanged')
    expect(fetched.stagingRoot.startsWith(cache)).toBe(true)
  })

  it('rejects a remote request when the volume is already bound locally', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'local' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('rejects a local request when the volume is already bound to a remote', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('rejects a different remote for an already-bound volume', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/first.git' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/second.git' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('does not persist supplied credentials and stores only the credential reference', async () => {
    const root = await directory(); const credentials = new FakeCredentialStore()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), credentials, volumes: resolver('private', root), cachePath: safeCachePath(root) })
    const token = 'ghp_123456789012345678901234567890123456'

    const binding = await service.bindVolume({ volumeId: 'private', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git', credential: { ref: 'keychain:private', secret: token } })
    expect(binding.credentialRef).toBe('keychain:private')
    expect(JSON.stringify(await service.listBindings())).not.toContain(token)
    expect(await readFile(path.join(root, 'config', '.ash', 'sync', 'git-bindings.json'), 'utf8')).not.toContain(token)
    await expect(credentials.get('keychain:private')).resolves.toBe(token)
  })

  it('rolls back a remote setup when credential storage fails, so a local retry starts cleanly', async () => {
    const root = await directory()
    let failCredentialWrite!: () => void
    const credentialWriteMayFail = new Promise<void>((resolve) => { failCredentialWrite = resolve })
    let credentialWriteStarted!: () => void
    const credentialWriteStartedPromise = new Promise<void>((resolve) => { credentialWriteStarted = resolve })
    class FailingCredentialStore extends FakeCredentialStore {
      override async put(): Promise<void> { credentialWriteStarted(); await credentialWriteMayFail; throw new Error('keychain unavailable') }
    }
    const credentials = new FailingCredentialStore()
    const bindings = new GitBindingStore(path.join(root, 'config'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings, credentials, volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    const repositoryPath = path.join(safeCachePath(root)('primary'), '.ash', 'sync', 'git')

    const remote = service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git', credential: { ref: 'keychain:primary', secret: 'test-secret' } })
    await credentialWriteStartedPromise
    const local = service.bindVolume({ volumeId: 'primary', mode: 'local' })
    failCredentialWrite()
    await expect(remote).rejects.toThrow('keychain unavailable')

    await expect(credentials.get('keychain:primary')).resolves.toBeUndefined()
    await expect(new GitRunner().exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath })).rejects.toThrow()
    await expect(local).resolves.toMatchObject({ mode: 'local' })
    await expect(bindings.list()).resolves.toMatchObject([{ mode: 'local' }])
  })

  it('rolls back credentials and repository changes when catalog persistence fails', async () => {
    const root = await directory()
    class FailingBindingStore extends GitBindingStore {
      private shouldFail = true
      override async bind(binding: Parameters<GitBindingStore['bind']>[0]) {
        if (this.shouldFail) { this.shouldFail = false; throw new Error('catalog unavailable') }
        return super.bind(binding)
      }
    }
    const credentials = new FakeCredentialStore()
    const bindings = new FailingBindingStore(path.join(root, 'config'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings, credentials, volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    const repositoryPath = path.join(safeCachePath(root)('primary'), '.ash', 'sync', 'git')

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git', credential: { ref: 'keychain:primary', secret: 'test-secret' } })).rejects.toThrow('catalog unavailable')

    await expect(bindings.list()).resolves.toEqual([])
    await expect(credentials.get('keychain:primary')).resolves.toBeUndefined()
    await expect(new GitRunner().exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath })).rejects.toThrow()
    await expect(new GitRunner().exec(['rev-parse', '--git-dir'], { cwd: repositoryPath })).rejects.toThrow()
    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).resolves.toMatchObject({ mode: 'local' })
    await expect(bindings.list()).resolves.toMatchObject([{ mode: 'local' }])
  })

  it('preserves a pre-existing repository and gitignore while undoing a failed remote binding', async () => {
    const root = await directory()
    const repositoryPath = path.join(safeCachePath(root)('primary'), '.ash', 'sync', 'git')
    await mkdir(repositoryPath, { recursive: true })
    await new GitRunner().exec(['init', '--quiet'], { cwd: repositoryPath })
    await writeFile(path.join(repositoryPath, '.gitignore'), 'keep-this-rule\n')
    class FailingBindingStore extends GitBindingStore {
      override async bind(): Promise<never> { throw new Error('catalog unavailable') }
    }
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new FailingBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git' })).rejects.toThrow('catalog unavailable')

    await expect(new GitRunner().exec(['rev-parse', '--git-dir'], { cwd: repositoryPath })).resolves.toMatchObject({ stdout: expect.any(String) })
    await expect(new GitRunner().exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath })).rejects.toThrow()
    await expect(readFile(path.join(repositoryPath, '.gitignore'), 'utf8')).resolves.toBe('keep-this-rule\n')
  })

  it('blocks a commit before Git add when a syncable group contains a known secret', async () => {
    const root = await directory(); const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    const repositoryPath = path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath)
    await writeFile(path.join(repositoryPath, 'safe.txt'), 'ordinary work content')
    await expect(service.commitLocalSnapshot('primary', 'safe snapshot')).resolves.toMatch(/^[-0-9a-f]+$/)
    await writeFile(path.join(repositoryPath, 'token.txt'), 'AKIAIOSFODNN7EXAMPLE')
    await expect(service.commitLocalSnapshot('primary', 'unsafe snapshot')).rejects.toThrow('Potential secret')
  })

  it('never performs a network push during local binding or commits', async () => {
    const root = await directory(); const commands: string[][] = []
    const real = new GitRunner()
    const runner = new GitRunner({ execFile: async (_file, args, options) => { commands.push([...args]); return real.exec(args, { cwd: options.cwd, env: options.env }) } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    await writeFile(path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath, 'safe.txt'), 'safe')
    await service.commitLocalSnapshot('primary', 'local only')
    expect(commands.flat()).not.toContain('push')
    expect(commands.flat()).not.toContain('fetch')
  })

  it.each([
    'https://alice:secret@example.test/repo.git',
    'https://example.test/repo.git?access_token=secret',
    'https://example.test/repo.git#secret',
    'ssh://alice:secret@example.test/repo.git',
    'https://token_12345678901234567890@example.test/repo.git',
  ])('rejects unsafe remote URL without persisting or passing it to git: %s', async (remoteUrl) => {
    const root = await directory(); const commands: string[][] = []
    const runner = new GitRunner({ execFile: async (_bin, args) => { commands.push([...args]); return { stdout: '', stderr: '' } } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl })).rejects.toThrow(/invalid|credentials/i)
    expect(commands.flat()).not.toContain(remoteUrl)
    await expect(readFile(path.join(root, 'config', '.ash', 'sync', 'git-bindings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves a binding against the current volume root after a volume migration', async () => {
    const oldRoot = await directory(); const newParent = await directory(); const newRoot = path.join(newParent, '.manta-ai')
    let activeRoot = oldRoot
    const volumes = { resolveVolumeRoot(id: string) { if (id !== 'primary') throw new Error('inactive'); return activeRoot } }
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(() => path.join(activeRoot, 'config')), volumes, cachePath: safeCachePath(oldRoot) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    await writeFile(path.join(safeCachePath(oldRoot)('primary'), binding.repositoryRelativePath, 'before.txt'), 'before')
    await service.commitLocalSnapshot('primary', 'before migration')
    await rename(oldRoot, newRoot); activeRoot = newRoot
    await expect(service.status('primary')).resolves.toContain('')
    await writeFile(path.join(safeCachePath(oldRoot)('primary'), binding.repositoryRelativePath, 'after.txt'), 'after')
    await expect(service.commitLocalSnapshot('primary', 'after migration')).resolves.toMatch(/^[-0-9a-f]+$/)
    expect((await service.listBindings())[0]).not.toHaveProperty('repositoryPath')
  })

  it.each(['secrets', 'diagnostics', 'cache'])('rejects and unstages force-added %s files, including pretracked files', async (group) => {
    const root = await directory(); const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' }); const repositoryPath = path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath)
    await mkdir(path.join(repositoryPath, group), { recursive: true }); await writeFile(path.join(repositoryPath, group, 'forced.txt'), 'not a known token')
    await new GitRunner().exec(['add', '-f', `${group}/forced.txt`], { cwd: repositoryPath })
    await expect(service.commitLocalSnapshot('primary', 'must fail')).rejects.toThrow(/excluded/i)
    await expect(new GitRunner().exec(['ls-files', '-z'], { cwd: repositoryPath })).resolves.toMatchObject({ stdout: '' })
  })

  it('snapshots persistent volume groups then commits and pushes them to a real bare remote', async () => {
    const root = await directory(); const remote = await directory(); const git = new GitRunner(); const leases = new StorageLeaseManager()
    await git.exec(['init', '--bare', '--quiet'], { cwd: remote })
    await mkdir(path.join(root, 'work'), { recursive: true }); await mkdir(path.join(root, 'knowledge'), { recursive: true }); await mkdir(path.join(root, 'secrets'), { recursive: true })
    await writeFile(path.join(root, 'work', 'task.md'), 'synchronized task')
    await writeFile(path.join(root, 'knowledge', 'rag.sqlite'), 'sqlite snapshot')
    await writeFile(path.join(root, 'knowledge', 'rag.sqlite-wal'), 'do not commit')
    await writeFile(path.join(root, 'secrets', 'key.txt'), 'not synchronized')
    const service = new GitSyncService({ runner: git, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root), snapshots: { generation: () => 9, leases } })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/ash.git' })
    await git.exec(['remote', 'set-url', 'origin', `file://${remote}`], { cwd: path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath) })

    const result = await service.syncVolume('primary')
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/)
    expect((await service.listBindings())[0]).toMatchObject({ lastSyncedGroupHashes: { work: expect.stringMatching(/^[a-f0-9]{64}$/) } })
    const clone = await directory(); await git.exec(['clone', '--quiet', `file://${remote}`, clone])
    await expect(readFile(path.join(clone, 'work', 'task.md'), 'utf8')).resolves.toBe('synchronized task')
    await expect(readFile(path.join(clone, 'knowledge', 'rag.sqlite-wal'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(clone, 'secrets', 'key.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(path.join(clone, 'ash-sync-manifest.json'), 'utf8')).groupHashes.work).toMatch(/^[a-f0-9]{64}$/)
  })

  it('redacts an offline remote failure and retries only the push without changing active data', async () => {
    const root = await directory(); const remote = await directory(); const real = new GitRunner(); const commands: string[][] = []; const leases = new StorageLeaseManager()
    await real.exec(['init', '--bare', '--quiet'], { cwd: remote }); await mkdir(path.join(root, 'work'), { recursive: true }); await writeFile(path.join(root, 'work', 'task.md'), 'safe')
    const runner = new GitRunner({ execFile: async (_binary, args, options) => { commands.push([...args]); return real.exec(args, { cwd: options.cwd, env: options.env }) } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root), cachePath: safeCachePath(root), snapshots: { generation: () => 1, leases } })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/ash.git' })
    // Simulate an offline endpoint after a previously valid configuration.
    await real.exec(['remote', 'set-url', 'origin', 'https://alice:token_12345678901234567890@example.test/ash.git'], { cwd: path.join(safeCachePath(root)('primary'), binding.repositoryRelativePath) })
    await expect(service.syncVolume('primary')).rejects.not.toThrow('token_12345678901234567890')
    expect(commands.filter((command) => command[0] === 'push')).toHaveLength(2)
    await expect(readFile(path.join(root, 'work', 'task.md'), 'utf8')).resolves.toBe('safe')
  })
})
