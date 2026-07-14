import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { STORAGE_GROUP_IDS } from '@manta/shared'
import { GitBindingStore } from './git-binding-store'
import { GitRunner, redactGitText } from './git-runner'
import { GitBindingConflictError, UnavailableCredentialStore, type CredentialStore, type GitBinding, type GitBindingMode, type GitCredentialInput } from './types'
import { buildVolumeSnapshot } from '../snapshot-builder'
import { hashSyncGroup, ImportCoordinator } from '../import-coordinator'
import { planGroupConflicts, type ConflictPlan, type ImportChoice } from '../conflict-planner'
import { SyncManifestSchema, syncManifestPath, type SyncManifest } from '../sync-manifest'
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

type ImportSession = {
  volumeId: string
  stagingRoot: string
  manifest: SyncManifest
  plan: ConflictPlan
  localHashes: Partial<Record<import('@manta/shared').StorageGroupId, string>>
  allowedChoices: Map<import('@manta/shared').StorageGroupId, ReadonlySet<ImportChoice>>
  expiresAt: number
}

const DEFAULT_IMPORT_SESSION_TTL_MS = 5 * 60_000

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
  private readonly imports = new Map<string, ImportSession>()
  constructor(private readonly options: { runner: GitRunner; bindings: GitBindingStore; volumes: { resolveVolumeRoot(volumeId: string): string }; cachePath: (volumeId: string) => string; credentials?: CredentialStore; snapshots?: { generation: () => number; leases: StorageLeaseManager; checkpoint?: (group: import('@manta/shared').StorageGroupId) => Promise<void> }; importer?: ImportCoordinator; now?: () => number; importSessionTtlMs?: number }) { this.credentials = options.credentials ?? new UnavailableCredentialStore() }

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

  async inspectPending(volumeId: string): Promise<{ pending: boolean; blockers: Array<{ code: string; path?: string; detail: string }> }> {
    const blockers: Array<{ code: string; path?: string; detail: string }> = []
    if ([...this.imports.values()].some((session) => session.volumeId === volumeId)) blockers.push({ code: 'git-import-pending', detail: 'An active Git import session exists' })
    const stagingRoot = resolve(this.options.cachePath(volumeId), '.ash', 'sync', 'import-staging')
    try {
      const stat = await lstat(stagingRoot)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Git import staging root is not an ordinary directory')
      for (const name of await readdir(stagingRoot)) {
        const entry = await lstat(resolve(stagingRoot, name))
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unsafe Git import staging entry ${name}`)
        blockers.push({ code: 'git-import-pending', detail: `Git import staging worktree ${name} exists` })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') blockers.push({ code: 'git-import-unreadable', path: stagingRoot, detail: error instanceof Error ? error.message : String(error) })
    }
    return { pending: blockers.length > 0, blockers }
  }

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

  /** Fetches and checks out a remote snapshot only inside the disposable cache workspace. */
  async fetchRemoteImport(volumeId: string): Promise<{ stagingRoot: string; manifest: SyncManifest }> {
    return this.withBindingLock(volumeId, async () => {
      const binding = await this.binding(volumeId)
      if (binding.mode !== 'remote') throw new Error('Only remote Git bindings can fetch an import')
      const repositoryPath = this.repositoryPath(volumeId)
      await this.options.runner.exec(['fetch', '--no-tags', 'origin'], { cwd: repositoryPath })
      const branch = (await this.options.runner.exec(['symbolic-ref', '--short', 'HEAD'], { cwd: repositoryPath })).stdout.trim()
      const ref = `refs/remotes/origin/${branch}`
      await this.options.runner.exec(['rev-parse', '--verify', ref], { cwd: repositoryPath })
      const stagingRoot = join(this.options.cachePath(volumeId), '.ash', 'sync', 'import-staging', randomUUID())
      await mkdir(join(stagingRoot, '..'), { recursive: true })
      try {
        // Git may populate a worktree here, but this path is in the cache group;
        // no command in this flow addresses the active user volume.
        await this.options.runner.exec(['worktree', 'add', '--detach', '--force', stagingRoot, ref], { cwd: repositoryPath })
        const manifest = SyncManifestSchema.parse(JSON.parse(await readFile(syncManifestPath(stagingRoot), 'utf8'))) as SyncManifest
        if (manifest.volumeId !== volumeId) throw new Error('Fetched sync manifest does not belong to this volume')
        for (const [group, expected] of Object.entries(manifest.groupHashes)) {
          const actual = await hashSyncGroup(join(stagingRoot, group))
          if (actual !== expected) throw new Error(`Fetched ${group} group hash validation failed`)
        }
        return { stagingRoot, manifest }
      } catch (error) {
        await this.options.runner.exec(['worktree', 'remove', '--force', stagingRoot], { cwd: repositoryPath }).catch(() => {})
        await rm(stagingRoot, { recursive: true, force: true })
        throw error
      }
    })
  }

  /** Creates an opaque, user-confirmable plan; paths never cross the privileged IPC boundary. */
  async planRemoteImport(volumeId: string): Promise<{ sessionId: string; plan: ConflictPlan }> {
    const fetched = await this.fetchRemoteImport(volumeId)
    try {
      return await this.withBindingLock(volumeId, async () => {
        const binding = await this.binding(volumeId)
        const local: Partial<Record<import('@manta/shared').StorageGroupId, string>> = {}
        for (const group of Object.keys(fetched.manifest.groupHashes) as import('@manta/shared').StorageGroupId[]) local[group] = await hashSyncGroup(join(this.options.volumes.resolveVolumeRoot(volumeId), group))
        const plan = planGroupConflicts({ base: binding.lastSyncedGroupHashes ?? {}, local, remote: fetched.manifest.groupHashes })
        const allowedChoices = new Map(plan.groups.map(({ group, choices }) => [group, new Set(choices)]))
        for (const [id, session] of this.imports) {
          if (session.volumeId !== volumeId) continue
          this.imports.delete(id)
          await this.removeStaging(volumeId, session.stagingRoot)
        }
        const sessionId = randomUUID()
        this.imports.set(sessionId, { volumeId, stagingRoot: fetched.stagingRoot, manifest: fetched.manifest, plan, localHashes: local, allowedChoices, expiresAt: this.now() + this.importSessionTtlMs() })
        return { sessionId, plan }
      })
    } catch (error) {
      await this.removeStaging(volumeId, fetched.stagingRoot)
      throw error
    }
  }

  async applyRemoteImport(volumeId: string, input: { sessionId: string; decisions: Partial<Record<import('@manta/shared').StorageGroupId, ImportChoice>> }): Promise<void> {
    return this.withBindingLock(volumeId, async () => {
      const session = this.imports.get(input.sessionId)
      if (!session || session.volumeId !== volumeId) throw new Error('Unknown or expired remote import plan')
      if (session.expiresAt !== undefined && this.now() >= session.expiresAt) {
        this.imports.delete(input.sessionId)
        await this.removeStaging(volumeId, session.stagingRoot)
        throw new Error('Remote import plan has expired')
      }
      if (!this.options.importer) throw new Error('Remote import is unavailable')
      this.validateImportDecisions(session, input.decisions)
      try { await this.options.importer.apply({ volumeId, stagingRoot: session.stagingRoot, manifest: session.manifest, decisions: input.decisions, expectedLocalHashes: session.localHashes }) }
      finally { this.imports.delete(input.sessionId); await this.removeStaging(volumeId, session.stagingRoot) }
    })
  }

  async discardRemoteImport(volumeId: string, sessionId: string): Promise<void> {
    return this.withBindingLock(volumeId, async () => {
      const session = this.imports.get(sessionId); if (!session || session.volumeId !== volumeId) return
      this.imports.delete(sessionId); await this.removeStaging(volumeId, session.stagingRoot)
    })
  }

  private async binding(volumeId: string): Promise<GitBinding> { const binding = await this.options.bindings.get(volumeId); if (!binding) throw new Error(`Volume ${volumeId} has no Git binding`); await this.ensureRepository(binding); return binding }
  private validateImportDecisions(session: { plan: ConflictPlan; allowedChoices: Map<import('@manta/shared').StorageGroupId, ReadonlySet<ImportChoice>> }, decisions: Partial<Record<import('@manta/shared').StorageGroupId, ImportChoice>>): void {
    for (const [rawGroup, choice] of Object.entries(decisions)) {
      const group = rawGroup as import('@manta/shared').StorageGroupId
      if (!choice || !session.allowedChoices.get(group)?.has(choice)) throw new Error(`Import decision for ${rawGroup} was not offered by this plan`)
    }
    // `unchanged` and `local-only` cannot alter the active data. Every remote
    // application and every conflict is therefore an explicit, one-use choice.
    for (const item of session.plan.groups) {
      const mustDecide = item.state === 'remote-addition' || item.state === 'remote-only' || item.state === 'conflict' || item.state === 'database-conflict'
      if (mustDecide && !decisions[item.group]) throw new Error(`Import decision for ${item.group} is required`)
    }
  }
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
  private now(): number { return this.options.now?.() ?? Date.now() }
  private importSessionTtlMs(): number {
    const ttl = this.options.importSessionTtlMs ?? DEFAULT_IMPORT_SESSION_TTL_MS
    return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_IMPORT_SESSION_TTL_MS
  }
  private async removeStaging(volumeId: string, stagingRoot: string): Promise<void> {
    const stagingParent = resolve(this.options.cachePath(volumeId), '.ash', 'sync', 'import-staging')
    const candidate = resolve(stagingRoot)
    const pathFromParent = relative(stagingParent, candidate)
    if (!pathFromParent || pathFromParent === '..' || pathFromParent.startsWith(`..${sep}`) || isAbsolute(pathFromParent)) return
    const repositoryPath = this.repositoryPath(volumeId)
    await this.options.runner.exec(['worktree', 'remove', '--force', stagingRoot], { cwd: repositoryPath }).catch(() => {})
    await rm(stagingRoot, { recursive: true, force: true })
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
