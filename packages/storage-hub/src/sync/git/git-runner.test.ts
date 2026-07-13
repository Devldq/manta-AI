import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  })
})

describe('GitSyncService', () => {
  it('initializes one local repository per volume and writes a safe gitignore', async () => {
    const root = await directory()
    const bindings = new GitBindingStore(path.join(root, 'bindings.json'))
    const service = new GitSyncService({ runner: new GitRunner(), bindings })

    const binding = await service.bindVolume({ volumeId: 'primary', volumeRoot: root, mode: 'local' })
    expect(binding).toMatchObject({ volumeId: 'primary', mode: 'local', repositoryPath: path.join(root, '.ash', 'sync', 'git') })
    await expect(readFile(path.join(binding.repositoryPath, '.gitignore'), 'utf8')).resolves.toContain('secrets/')
    await expect(service.bindVolume({ volumeId: 'primary', volumeRoot: root, mode: 'local' })).resolves.toEqual(binding)
    await expect(bindings.list()).resolves.toHaveLength(1)
  })

  it('does not persist supplied credentials and stores only the credential reference', async () => {
    const root = await directory(); const credentials = new FakeCredentialStore()
    const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'bindings.json')), credentials })
    const token = 'ghp_123456789012345678901234567890123456'

    const binding = await service.bindVolume({ volumeId: 'private', volumeRoot: root, mode: 'remote', remoteUrl: 'https://example.test/owner/repository.git', credential: { ref: 'keychain:private', secret: token } })
    expect(binding.credentialRef).toBe('keychain:private')
    expect(JSON.stringify(await service.listBindings())).not.toContain(token)
    expect(await readFile(path.join(root, 'bindings.json'), 'utf8')).not.toContain(token)
    await expect(credentials.get('keychain:private')).resolves.toBe(token)
  })

  it('blocks a commit before Git add when a syncable group contains a known secret', async () => {
    const root = await directory(); const service = new GitSyncService({ runner: new GitRunner(), bindings: new GitBindingStore(path.join(root, 'bindings.json')) })
    const binding = await service.bindVolume({ volumeId: 'primary', volumeRoot: root, mode: 'local' })
    await writeFile(path.join(binding.repositoryPath, 'safe.txt'), 'ordinary work content')
    await expect(service.commitLocalSnapshot('primary', 'safe snapshot')).resolves.toMatch(/^[-0-9a-f]+$/)
    await writeFile(path.join(binding.repositoryPath, 'token.txt'), 'AKIAIOSFODNN7EXAMPLE')
    await expect(service.commitLocalSnapshot('primary', 'unsafe snapshot')).rejects.toThrow('Potential secret')
  })

  it('never performs a network push during local binding or commits', async () => {
    const root = await directory(); const commands: string[][] = []
    const real = new GitRunner()
    const runner = new GitRunner({ execFile: async (_file, args, options) => { commands.push([...args]); return real.exec(args, { cwd: options.cwd, env: options.env }) } })
    const service = new GitSyncService({ runner, bindings: new GitBindingStore(path.join(root, 'bindings.json')) })
    const binding = await service.bindVolume({ volumeId: 'primary', volumeRoot: root, mode: 'local' })
    await writeFile(path.join(binding.repositoryPath, 'safe.txt'), 'safe')
    await service.commitLocalSnapshot('primary', 'local only')
    expect(commands.flat()).not.toContain('push')
    expect(commands.flat()).not.toContain('fetch')
  })
})
