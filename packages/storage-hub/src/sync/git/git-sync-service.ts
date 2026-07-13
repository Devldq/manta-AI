import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { GitBindingStore } from './git-binding-store'
import { GitRunner, redactGitText } from './git-runner'
import { GitBindingConflictError, UnavailableCredentialStore, type CredentialStore, type GitBinding, type GitBindingMode, type GitCredentialInput } from './types'
import { buildVolumeSnapshot } from '../snapshot-builder'
import type { StorageLeaseManager } from '../../runtime/lease-manager'

const SYNC_EXCLUDED_GROUPS = new Set(['secrets', 'diagnostics', 'cache'])
const SAFE_IGNORE = ['# Manta ASH Git snapshots never include sensitive or transient groups.', 'secrets/', 'diagnostics/', 'cache/', '.ash/'].join('\n') + '\n'

const REPOSITORY_RELATIVE_PATH = join('.ash', 'sync', 'git')

type BindTransaction = {
  gitDirectoryCreated: boolean
  remoteAdded: boolean
  gitignore?: { path: string; original?: string }
  credential?: { ref: string; original?: string }
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

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
  /** Desktop binding requests share this service instance; serialize each volume's full setup transaction. */
  private readonly bindingTails = new Map<string, Promise<void>>()
  constructor(private readonly options: { runner: GitRunner; bindings: GitBindingStore; volumes: { resolveVolumeRoot(volumeId: string): string }; cachePath: (volumeId: string) => string; credentials?: CredentialStore; snapshots?: { generation: () => number; leases: StorageLeaseManager; checkpoint?: (group: import('@manta/shared').StorageGroupId) => Promise<void> } }) { this.credentials = options.credentials ?? new UnavailableCredentialStore() }

  async bindVolume(input: { volumeId: string; mode: GitBindingMode; remoteUrl?: string; credentialRef?: string; credential?: GitCredentialInput }): Promise<GitBinding> {
    if (input.mode === 'remote' && !input.remoteUrl) throw new Error('Remote Git binding requires a remote URL')
    if (input.remoteUrl) assertSafeRemote(input.remoteUrl)
    if (input.credential && !this.credentials.available) throw new Error('A secure OS credential store is unavailable')
    if (input.credentialRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(input.credentialRef)) throw new Error('Git credential reference is invalid')
    return this.withBindingLock(input.volumeId, async () => {
      const existing = await this.options.bindings.get(input.volumeId)
      const credentialRef = input.credential?.ref ?? input.credentialRef
      if (existing) {
        if (existing.mode !== input.mode || existing.remoteUrl !== input.remoteUrl || existing.credentialRef !== credentialRef) throw new GitBindingConflictError(input.volumeId)
        await this.ensureRepository(existing)
        return existing
      }
      const repositoryPath = this.repositoryPath(input.volumeId)
      const transaction: BindTransaction = { gitDirectoryCreated: false, remoteAdded: false }
      try {
        await mkdir(repositoryPath, { recursive: true })
        const gitDirectory = join(repositoryPath, '.git')
        const hadGitDirectory = await exists(gitDirectory)
        await this.options.runner.exec(['init', '--quiet'], { cwd: repositoryPath })
        transaction.gitDirectoryCreated = !hadGitDirectory && await exists(gitDirectory)
        const gitignorePath = join(repositoryPath, '.gitignore')
        transaction.gitignore = { path: gitignorePath, original: await readOptional(gitignorePath) }
        await writeFile(gitignorePath, SAFE_IGNORE, 'utf8')
        if (input.mode === 'remote' && input.remoteUrl) {
          await this.options.runner.exec(['remote', 'add', 'origin', input.remoteUrl], { cwd: repositoryPath })
          transaction.remoteAdded = true
        }
        if (input.credential) {
          transaction.credential = { ref: input.credential.ref, original: await this.credentials.get(input.credential.ref) }
          await this.credentials.put(input.credential.ref, input.credential.secret)
        }
        const now = new Date().toISOString()
        return await this.options.bindings.bind({ volumeId: input.volumeId, repositoryRelativePath: REPOSITORY_RELATIVE_PATH, mode: input.mode, remoteUrl: input.remoteUrl, credentialRef, createdAt: now, updatedAt: now })
      } catch (error) {
        await this.rollbackBind(repositoryPath, transaction, error)
        throw error
      }
    })
  }

  async listBindings(): Promise<GitBinding[]> { return this.options.bindings.list() }
  async capability() { return this.options.runner.capability() }

  async status(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['status', '--porcelain=v1'], { cwd: this.repositoryPath(binding.volumeId) })).stdout }
  async history(volumeId: string): Promise<string> { const binding = await this.binding(volumeId); return (await this.options.runner.exec(['log', '--format=%H%x09%s', '-n', '50'], { cwd: this.repositoryPath(binding.volumeId) })).stdout }

  async commitLocalSnapshot(volumeId: string, message: string): Promise<string> {
    const binding = await this.binding(volumeId); const repositoryPath = this.repositoryPath(binding.volumeId); await this.scanForSecrets(repositoryPath)
    await this.options.runner.exec(['add', '--all'], { cwd: repositoryPath })
    const status = await this.status(volumeId)
    if (!status.trim()) return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
    await this.options.runner.exec(['-c', 'user.name=Manta ASH', '-c', 'user.email=ash@localhost', 'commit', '--quiet', '-m', message], { cwd: repositoryPath })
    return (await this.options.runner.exec(['rev-parse', '--verify', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
  }

  /**
   * Produces a lease-protected cache snapshot before Git touches it.  No Git
   * checkout, merge, or reset is ever performed against the active volume.
   */
  async syncVolume(volumeId: string): Promise<{ commit: string; groupHashes: Partial<Record<import('@manta/shared').StorageGroupId, string>> }> {
    if (!this.options.snapshots) throw new Error('Git snapshot support is unavailable')
    return this.withBindingLock(volumeId, async () => {
      const binding = await this.binding(volumeId); const repositoryPath = this.repositoryPath(binding.volumeId)
      const manifest = await buildVolumeSnapshot({ volumeId, generation: this.options.snapshots!.generation(), volumeRoot: this.options.volumes.resolveVolumeRoot(volumeId), cachePath: repositoryPath, leases: this.options.snapshots!.leases, checkpoint: this.options.snapshots!.checkpoint })
      const commit = await this.commitLocalSnapshot(volumeId, `ASH snapshot ${manifest.generation}`)
      if (binding.mode === 'remote') await this.pushWithRetry(repositoryPath)
      await this.options.bindings.recordSync(volumeId, manifest.groupHashes)
      return { commit, groupHashes: manifest.groupHashes }
    })
  }

  private async binding(volumeId: string): Promise<GitBinding> { const binding = await this.options.bindings.get(volumeId); if (!binding) throw new Error(`Volume ${volumeId} has no Git binding`); await this.ensureRepository(binding); return binding }
  /** Recreates only the disposable checkout if a cache cleanup or cache migration removed it. */
  private async ensureRepository(binding: GitBinding): Promise<void> {
    const repositoryPath = this.repositoryPath(binding.volumeId)
    await mkdir(repositoryPath, { recursive: true })
    const rebuilt = !await exists(join(repositoryPath, '.git'))
    if (rebuilt) await this.options.runner.exec(['init', '--quiet'], { cwd: repositoryPath })
    const gitignorePath = join(repositoryPath, '.gitignore')
    if (!await exists(gitignorePath)) await writeFile(gitignorePath, SAFE_IGNORE, 'utf8')
    if (binding.mode !== 'remote' || !binding.remoteUrl) return
    try { await this.options.runner.exec(['remote', 'get-url', 'origin'], { cwd: repositoryPath }) }
    catch { await this.options.runner.exec(['remote', 'add', 'origin', binding.remoteUrl], { cwd: repositoryPath }) }
    if (!rebuilt) return
    // Recreate the local branch ancestry without checking out, merging, or
    // resetting snapshot files. This only touches the disposable cache repo,
    // so a later snapshot commit remains a fast-forward of the remote state.
    await this.options.runner.exec(['fetch', '--no-tags', 'origin'], { cwd: repositoryPath })
    const branch = (await this.options.runner.exec(['symbolic-ref', '--short', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
    const remoteRef = `refs/remotes/origin/${branch}`
    try {
      const remoteCommit = (await this.options.runner.exec(['rev-parse', '--verify', remoteRef], { cwd: repositoryPath })).stdout.trim()
      await this.options.runner.exec(['update-ref', `refs/heads/${branch}`, remoteCommit], { cwd: repositoryPath })
    } catch {
      // An empty remote has no branch yet; the first snapshot will create it.
    }
  }
  private async pushWithRetry(repositoryPath: string): Promise<void> {
    const branch = (await this.options.runner.exec(['symbolic-ref', '--short', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await this.options.runner.exec(['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd: repositoryPath }); return } catch (error) { lastError = error }
    }
    throw lastError
  }
  private async withBindingLock<T>(volumeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.bindingTails.get(volumeId) ?? Promise.resolve()
    let release!: () => void
    const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    this.bindingTails.set(volumeId, current)
    await previous.catch(() => undefined)
    try { return await operation() } finally { release(); if (this.bindingTails.get(volumeId) === current) this.bindingTails.delete(volumeId) }
  }
  /** Reverts only resources created or overwritten by the active binding transaction. */
  private async rollbackBind(repositoryPath: string, transaction: BindTransaction, original: unknown): Promise<void> {
    const failures: unknown[] = []
    const attempt = async (operation: () => Promise<void>) => { try { await operation() } catch (error) { failures.push(error) } }
    if (transaction.credential) await attempt(async () => {
      if (transaction.credential!.original === undefined) await this.credentials.remove(transaction.credential!.ref)
      else await this.credentials.put(transaction.credential!.ref, transaction.credential!.original)
    })
    if (transaction.remoteAdded) await attempt(async () => { await this.options.runner.exec(['remote', 'remove', 'origin'], { cwd: repositoryPath }) })
    if (transaction.gitignore) await attempt(async () => {
      if (transaction.gitignore!.original === undefined) await rm(transaction.gitignore!.path, { force: true })
      else await writeFile(transaction.gitignore!.path, transaction.gitignore!.original, 'utf8')
    })
    if (transaction.gitDirectoryCreated) await attempt(async () => { await rm(join(repositoryPath, '.git'), { recursive: true, force: true }) })
    if (failures.length) throw new AggregateError([original, ...failures], 'Git binding failed and rollback was incomplete', { cause: original })
  }
  private repositoryPath(volumeId: string): string {
    // A Git checkout is a transient rebuildable workspace.  Keeping it under the
    // injected cache group guarantees snapshots never include their own .git data
    // and lets cache/group migration carry it safely without touching source data.
    if (typeof this.options.cachePath !== 'function') throw new Error('Git cache workspace resolver is required')
    const root = this.options.cachePath(volumeId)
    if (!root) throw new Error(`Volume ${volumeId} has an invalid cache workspace`)
    const volumeRoot = resolve(this.options.volumes.resolveVolumeRoot(volumeId))
    if (resolve(root) === volumeRoot) throw new Error(`Volume ${volumeId} cannot use its active volume as a Git cache workspace`)
    const path = resolve(root, REPOSITORY_RELATIVE_PATH)
    const pathRelative = relative(root, path)
    if (pathRelative === '..' || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) throw new Error(`Volume ${volumeId} has an invalid cache workspace`)
    for (const group of STORAGE_GROUP_IDS) {
      if (SYNC_EXCLUDED_GROUPS.has(group)) continue
      const groupRelative = relative(join(volumeRoot, group), path)
      if (groupRelative === '' || (groupRelative !== '..' && !groupRelative.startsWith(`..${sep}`) && !isAbsolute(groupRelative))) {
        throw new Error(`Volume ${volumeId} cannot use a syncable storage group as a Git cache workspace`)
      }
    }
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
