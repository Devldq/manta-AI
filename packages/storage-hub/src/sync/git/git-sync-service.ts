import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { GitBindingStore } from './git-binding-store'
import { GitRunner, redactGitText } from './git-runner'
import { GitBindingConflictError, UnavailableCredentialStore, type CredentialStore, type GitBinding, type GitBindingMode, type GitCredentialInput } from './types'

const SYNC_EXCLUDED_GROUPS = new Set(['secrets', 'diagnostics', 'cache'])
const SAFE_IGNORE = ['# Manta ASH Git snapshots never include sensitive or transient groups.', 'secrets/', 'diagnostics/', 'cache/', '.ash/'].join('\n') + '\n'

const REPOSITORY_RELATIVE_PATH = join('.ash', 'sync', 'git')

function assertSafeRemote(remoteUrl: string): void {
  // URLs are deliberately credential-free. SSH users and scp syntax are omitted so a
  // value that looks like userinfo can never become part of persisted Git config.
  if (/\s|@|[?#]/.test(remoteUrl) || /(?:token|secret|password|credential|key)=?/i.test(remoteUrl)) throw new Error('Git remote URL is invalid or contains credentials')
  let parsed: URL
  try { parsed = new URL(remoteUrl) } catch { throw new Error('Git remote URL is invalid or contains credentials') }
  if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Git remote URL is invalid or contains credentials')
}

function hasPotentialSecret(content: string): boolean {
  return /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/.test(content)
}

export class GitSyncService {
  private readonly credentials: CredentialStore
  constructor(private readonly options: { runner: GitRunner; bindings: GitBindingStore; volumes: { resolveVolumeRoot(volumeId: string): string }; credentials?: CredentialStore }) { this.credentials = options.credentials ?? new UnavailableCredentialStore() }

  async bindVolume(input: { volumeId: string; mode: GitBindingMode; remoteUrl?: string; credentialRef?: string; credential?: GitCredentialInput }): Promise<GitBinding> {
    if (input.mode === 'remote' && !input.remoteUrl) throw new Error('Remote Git binding requires a remote URL')
    if (input.remoteUrl) assertSafeRemote(input.remoteUrl)
    if (input.credential && !this.credentials.available) throw new Error('A secure OS credential store is unavailable')
    if (input.credentialRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(input.credentialRef)) throw new Error('Git credential reference is invalid')
    const existing = await this.options.bindings.get(input.volumeId)
    const credentialRef = input.credential?.ref ?? input.credentialRef
    if (existing) {
      if (existing.mode !== input.mode || existing.remoteUrl !== input.remoteUrl || existing.credentialRef !== credentialRef) throw new GitBindingConflictError(input.volumeId)
      return existing
    }
    const repositoryPath = this.repositoryPath({ volumeId: input.volumeId, repositoryRelativePath: REPOSITORY_RELATIVE_PATH } as GitBinding)
    await mkdir(repositoryPath, { recursive: true })
    await this.options.runner.exec(['init', '--quiet'], { cwd: repositoryPath })
    await writeFile(join(repositoryPath, '.gitignore'), SAFE_IGNORE, 'utf8')
    if (input.mode === 'remote' && input.remoteUrl) await this.options.runner.exec(['remote', 'add', 'origin', input.remoteUrl], { cwd: repositoryPath })
    if (input.credential) await this.credentials.put(input.credential.ref, input.credential.secret)
    const now = new Date().toISOString()
    return this.options.bindings.bind({ volumeId: input.volumeId, repositoryRelativePath: REPOSITORY_RELATIVE_PATH, mode: input.mode, remoteUrl: input.remoteUrl, credentialRef, createdAt: now, updatedAt: now })
  }

  async listBindings(): Promise<GitBinding[]> { return this.options.bindings.list() }
  async capability() { return this.options.runner.capability() }

  async status(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['status', '--porcelain=v1'], { cwd: this.repositoryPath(binding) })).stdout }
  async history(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['log', '--format=%H%x09%s', '-n', '50'], { cwd: this.repositoryPath(binding) })).stdout }

  async commitLocalSnapshot(volumeId: string, message: string): Promise<string> {
    const binding = await this.binding(volumeId); const repositoryPath = this.repositoryPath(binding); await this.scanForSecrets(repositoryPath)
    await this.options.runner.exec(['add', '--all'], { cwd: repositoryPath })
    const status = await this.status(volumeId)
    if (!status.trim()) return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
    await this.options.runner.exec(['-c', 'user.name=Manta ASH', '-c', 'user.email=ash@localhost', 'commit', '--quiet', '-m', message], { cwd: repositoryPath })
    return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
  }

  private async binding(volumeId: string): Promise<GitBinding> { const binding = await this.options.bindings.get(volumeId); if (!binding) throw new Error(`Volume ${volumeId} has no Git binding`); this.repositoryPath(binding); return binding }
  private repositoryPath(binding: Pick<GitBinding, 'volumeId' | 'repositoryRelativePath'>): string {
    const root = this.options.volumes.resolveVolumeRoot(binding.volumeId)
    const path = resolve(root, binding.repositoryRelativePath)
    const pathRelative = relative(root, path)
    if (!root || isAbsolute(binding.repositoryRelativePath) || pathRelative === '..' || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) throw new Error(`Volume ${binding.volumeId} is not active or has an invalid Git binding`)
    return path
  }
  private async scanForSecrets(repositoryPath: string): Promise<void> {
    const tracked = await this.options.runner.exec(['ls-files', '-z'], { cwd: repositoryPath })
    const excluded = tracked.stdout.split('\0').filter((file) => SYNC_EXCLUDED_GROUPS.has(file.split('/')[0]))
    if (excluded.length) {
      await this.options.runner.exec(['rm', '--cached', '-r', '--ignore-unmatch', '--', ...[...SYNC_EXCLUDED_GROUPS]], { cwd: repositoryPath })
      throw new Error(`Excluded storage group is tracked and was unstaged: ${excluded.join(', ')}`)
    }
    const output = await this.options.runner.exec(['ls-files', '-z', '--others', '--cached', '--exclude-standard'], { cwd: repositoryPath })
    for (const relative of output.stdout.split('\0').filter(Boolean)) {
      const top = relative.split('/')[0]; if (SYNC_EXCLUDED_GROUPS.has(top)) continue
      const filePath = join(repositoryPath, relative)
      let stat
      try { stat = await lstat(filePath) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw new Error(redactGitText((error as Error).message)) }
      if (!stat.isFile()) continue
      let content: string
      try { content = await readFile(filePath, 'utf8') } catch (error) { if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue; throw new Error(redactGitText((error as Error).message)) }
      if (hasPotentialSecret(content)) throw new Error(`Potential secret detected in ${relative}; Git commit was blocked`)
    }
  }
}
