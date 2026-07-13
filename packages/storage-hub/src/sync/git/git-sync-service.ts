import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GitBindingStore } from './git-binding-store'
import { GitRunner } from './git-runner'
import { UnavailableCredentialStore, type CredentialStore, type GitBinding, type GitBindingMode, type GitCredentialInput } from './types'

const SYNC_EXCLUDED_GROUPS = new Set(['secrets', 'diagnostics'])
const SAFE_IGNORE = ['# Manta ASH Git snapshots never include sensitive or transient groups.', 'secrets/', 'diagnostics/', 'cache/', '.ash/'].join('\n') + '\n'

function assertSafeRemote(remoteUrl: string): void {
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]+)?$|^ssh:\/\/[^\s]+$|^[^\s@]+@[^\s:]+:[^\s]+$/.test(remoteUrl) || /:\/\/[^\s/@:]+:[^\s/@]+@/.test(remoteUrl)) throw new Error('Git remote URL is invalid or contains credentials')
}

function hasPotentialSecret(content: string): boolean {
  return /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/.test(content)
}

export class GitSyncService {
  private readonly credentials: CredentialStore
  constructor(private readonly options: { runner: GitRunner; bindings: GitBindingStore; credentials?: CredentialStore }) { this.credentials = options.credentials ?? new UnavailableCredentialStore() }

  async bindVolume(input: { volumeId: string; volumeRoot: string; mode: GitBindingMode; remoteUrl?: string; credential?: GitCredentialInput }): Promise<GitBinding> {
    if (input.mode === 'remote' && !input.remoteUrl) throw new Error('Remote Git binding requires a remote URL')
    if (input.remoteUrl) assertSafeRemote(input.remoteUrl)
    if (input.credential && !this.credentials.available) throw new Error('A secure OS credential store is unavailable')
    const repositoryPath = join(input.volumeRoot, '.ash', 'sync', 'git')
    const existing = await this.options.bindings.get(input.volumeId)
    if (existing) return this.options.bindings.bind({ ...existing })
    await mkdir(repositoryPath, { recursive: true })
    await this.options.runner.exec(['init', '--quiet'], { cwd: repositoryPath })
    await writeFile(join(repositoryPath, '.gitignore'), SAFE_IGNORE, 'utf8')
    if (input.mode === 'remote' && input.remoteUrl) await this.options.runner.exec(['remote', 'add', 'origin', input.remoteUrl], { cwd: repositoryPath })
    if (input.credential) await this.credentials.put(input.credential.ref, input.credential.secret)
    const now = new Date().toISOString()
    return this.options.bindings.bind({ volumeId: input.volumeId, repositoryPath, mode: input.mode, remoteUrl: input.remoteUrl, credentialRef: input.credential?.ref, createdAt: now, updatedAt: now })
  }

  async listBindings(): Promise<GitBinding[]> { return this.options.bindings.list() }

  async status(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['status', '--porcelain=v1'], { cwd: binding.repositoryPath })).stdout }
  async history(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['log', '--format=%H%x09%s', '-n', '50'], { cwd: binding.repositoryPath })).stdout }

  async commitLocalSnapshot(volumeId: string, message: string): Promise<string> {
    const binding = await this.binding(volumeId); await this.scanForSecrets(binding.repositoryPath)
    await this.options.runner.exec(['add', '--all'], { cwd: binding.repositoryPath })
    const status = await this.status(volumeId)
    if (!status.trim()) return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: binding.repositoryPath })).stdout.trim()
    await this.options.runner.exec(['-c', 'user.name=Manta ASH', '-c', 'user.email=ash@localhost', 'commit', '--quiet', '-m', message], { cwd: binding.repositoryPath })
    return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: binding.repositoryPath })).stdout.trim()
  }

  private async binding(volumeId: string): Promise<GitBinding> { const binding = await this.options.bindings.get(volumeId); if (!binding) throw new Error(`Volume ${volumeId} has no Git binding`); return binding }
  private async scanForSecrets(repositoryPath: string): Promise<void> {
    const output = await this.options.runner.exec(['ls-files', '--others', '--cached', '--exclude-standard'], { cwd: repositoryPath })
    for (const relative of output.stdout.split(/\r?\n/).filter(Boolean)) {
      const top = relative.split('/')[0]; if (SYNC_EXCLUDED_GROUPS.has(top)) continue
      const content = await readFile(join(repositoryPath, relative), 'utf8').catch(() => '')
      if (hasPotentialSecret(content)) throw new Error(`Potential secret detected in ${relative}; Git commit was blocked`)
    }
  }
}
