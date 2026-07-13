import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeCredentialStore, GitBindingStore, GitRunner, GitSyncService, redactGitText } from './index'

const directories: string[] = []

async function directory(): Promise<string> {
  const result = await mkdtemp(path.join(tmpdir(), 'ash-git-'))
  directories.push(result)
  return result
}

afterEach(async () => { await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true }))) })

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

describe('GitSyncService', () => {
  function resolver(volumeId: string, root: string): { resolveVolumeRoot(id: string): string } {
    return { resolveVolumeRoot(id) { if (id !== volumeId) throw new Error(`Inactive volume ${id}`); return root } }
  }

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
    const service = new GitSyncService({ runner: new GitRunner(), bindings, volumes: resolver('primary', root) })

    const remoteUrl = 'https://example.test/owner/repository.git'
    const remote = service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const local = service.bindVolume({ volumeId: 'primary', mode: 'local' })
    const outcomes = await Promise.allSettled([remote, local])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => (outcome as PromiseRejectedResult).reason)).toEqual([expect.objectContaining({ code: 'GIT_BINDING_CONFLICT' })])
    const [binding] = await bindings.list()
    expect(binding).toBeDefined()
    const repositoryPath = path.join(root, binding.repositoryRelativePath)
    const configuredRemote = await new GitRunner().exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath }).then((result) => result.stdout.trim()).catch(() => undefined)
    expect(configuredRemote).toBe(binding.mode === 'remote' ? remoteUrl : undefined)
  })

  it('initializes one local repository per volume and writes a safe gitignore', async () => {
    const root = await directory()
    const bindings = new GitBindingStore(path.join(root, 'config'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings, volumes: resolver('primary', root) })

    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    expect(binding).toMatchObject({ volumeId: 'primary', mode: 'local', repositoryRelativePath: path.join('.ash', 'sync', 'git') })
    await expect(readFile(path.join(root, binding.repositoryRelativePath, '.gitignore'), 'utf8')).resolves.toContain('secrets/')
    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).resolves.toEqual(binding)
    await expect(bindings.list()).resolves.toHaveLength(1)
  })

  it('rejects a remote request when the volume is already bound locally', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'local' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('rejects a local request when the volume is already bound to a remote', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'local' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('rejects a different remote for an already-bound volume', async () => {
    const root = await directory()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })

    await service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/first.git' })

    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl: 'https://example.test/owner/second.git' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT' })
  })

  it('does not persist supplied credentials and stores only the credential reference', async () => {
    const root = await directory(); const credentials = new FakeCredentialStore()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), credentials, volumes: resolver('private', root) })
    const token = 'ghp_123456789012345678901234567890123456'

    const binding = await service.bindVolume({ volumeId: 'private', mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git', credential: { ref: 'keychain:private', secret: token } })
    expect(binding.credentialRef).toBe('keychain:private')
    expect(JSON.stringify(await service.listBindings())).not.toContain(token)
    expect(await readFile(path.join(root, 'config', '.ash', 'sync', 'git-bindings.json'), 'utf8')).not.toContain(token)
    await expect(credentials.get('keychain:private')).resolves.toBe(token)
  })

  it('blocks a commit before Git add when a syncable group contains a known secret', async () => {
    const root = await directory(); const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    const repositoryPath = path.join(root, binding.repositoryRelativePath)
    await writeFile(path.join(repositoryPath, 'safe.txt'), 'ordinary work content')
    await expect(service.commitLocalSnapshot('primary', 'safe snapshot')).resolves.toMatch(/^[-0-9a-f]+$/)
    await writeFile(path.join(repositoryPath, 'token.txt'), 'AKIAIOSFODNN7EXAMPLE')
    await expect(service.commitLocalSnapshot('primary', 'unsafe snapshot')).rejects.toThrow('Potential secret')
  })

  it('never performs a network push during local binding or commits', async () => {
    const root = await directory(); const commands: string[][] = []
    const real = new GitRunner()
    const runner = new GitRunner({ execFile: async (_file, args, options) => { commands.push([...args]); return real.exec(args, { cwd: options.cwd, env: options.env }) } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    await writeFile(path.join(root, binding.repositoryRelativePath, 'safe.txt'), 'safe')
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
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })
    await expect(service.bindVolume({ volumeId: 'primary', mode: 'remote', remoteUrl })).rejects.toThrow(/invalid|credentials/i)
    expect(commands.flat()).not.toContain(remoteUrl)
    await expect(readFile(path.join(root, 'config', '.ash', 'sync', 'git-bindings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves a binding against the current volume root after a volume migration', async () => {
    const oldRoot = await directory(); const newParent = await directory(); const newRoot = path.join(newParent, '.manta-ai')
    let activeRoot = oldRoot
    const volumes = { resolveVolumeRoot(id: string) { if (id !== 'primary') throw new Error('inactive'); return activeRoot } }
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(() => path.join(activeRoot, 'config')), volumes })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' })
    await writeFile(path.join(oldRoot, binding.repositoryRelativePath, 'before.txt'), 'before')
    await service.commitLocalSnapshot('primary', 'before migration')
    await rename(oldRoot, newRoot); activeRoot = newRoot
    await expect(service.status('primary')).resolves.toContain('')
    await writeFile(path.join(newRoot, binding.repositoryRelativePath, 'after.txt'), 'after')
    await expect(service.commitLocalSnapshot('primary', 'after migration')).resolves.toMatch(/^[-0-9a-f]+$/)
    expect((await service.listBindings())[0]).not.toHaveProperty('repositoryPath')
  })

  it.each(['secrets', 'diagnostics', 'cache'])('rejects and unstages force-added %s files, including pretracked files', async (group) => {
    const root = await directory(); const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'config')), volumes: resolver('primary', root) })
    const binding = await service.bindVolume({ volumeId: 'primary', mode: 'local' }); const repositoryPath = path.join(root, binding.repositoryRelativePath)
    await mkdir(path.join(repositoryPath, group), { recursive: true }); await writeFile(path.join(repositoryPath, group, 'forced.txt'), 'not a known token')
    await new GitRunner().exec(['add', '-f', `${group}/forced.txt`], { cwd: repositoryPath })
    await expect(service.commitLocalSnapshot('primary', 'must fail')).rejects.toThrow(/excluded/i)
    await expect(new GitRunner().exec(['ls-files', '-z'], { cwd: repositoryPath })).resolves.toMatchObject({ stdout: '' })
  })
})
