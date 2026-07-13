import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GitRemoteUrlSchema } from '@manta/shared'
import { writeJsonAtomic } from '../../bootstrap/atomic-json'
import type { GitBinding } from './types'

interface GitBindingCatalog { schemaVersion: 1; bindings: GitBinding[] }
const empty = (): GitBindingCatalog => ({ schemaVersion: 1, bindings: [] })

function validate(binding: GitBinding & { repositoryRelativePath?: unknown }): GitBinding {
  // `repositoryRelativePath` was used by the first preview implementation.
  // Drop it while reading so a migrated catalog can never point Git at an active
  // (and therefore syncable) volume again.
  const { repositoryRelativePath, ...withoutPath } = binding
  const normalized = { ...withoutPath, repositoryRelativePath: typeof repositoryRelativePath === 'string' && repositoryRelativePath ? repositoryRelativePath : join('.ash', 'sync', 'git') }
  if (!normalized.volumeId || !normalized.mode || !normalized.createdAt || !normalized.updatedAt) throw new Error('Invalid Git binding')
  if (binding.mode === 'remote' && !binding.remoteUrl) throw new Error('Remote Git binding requires a remote URL')
  if (binding.remoteUrl && !GitRemoteUrlSchema.safeParse(binding.remoteUrl).success) throw new Error('Git remote URL is invalid or contains credentials')
  if (binding.credentialRef?.trim() === '') throw new Error('Git credential reference must not be empty')
  return normalized
}

export class GitBindingStore {
  /** The catalog is always stored beneath the injected config-group root. */
  constructor(private readonly configRoot: string | (() => string)) {}

  private get filePath(): string {
    const root = typeof this.configRoot === 'function' ? this.configRoot() : this.configRoot
    return join(root, '.ash', 'sync', 'git-bindings.json')
  }

  async list(): Promise<GitBinding[]> { return (await this.read()).bindings.map(validate) }
  async get(volumeId: string): Promise<GitBinding | undefined> { return (await this.list()).find((item) => item.volumeId === volumeId) }

  async bind(binding: GitBinding): Promise<GitBinding> {
    const valid = validate(binding); const catalog = await this.read(); const existing = catalog.bindings.find((item) => item.volumeId === valid.volumeId)
    if (existing) {
      if (existing.mode !== valid.mode || existing.remoteUrl !== valid.remoteUrl || existing.credentialRef !== valid.credentialRef) throw new Error(`Volume ${valid.volumeId} already has a Git binding`)
      return existing
    }
    await writeJsonAtomic(this.filePath, { schemaVersion: 1, bindings: [...catalog.bindings, valid] })
    return valid
  }

  async recordSync(volumeId: string, groupHashes: NonNullable<GitBinding['lastSyncedGroupHashes']>): Promise<GitBinding> {
    const catalog = await this.read(); const index = catalog.bindings.findIndex((item) => item.volumeId === volumeId)
    if (index < 0) throw new Error(`Volume ${volumeId} has no Git binding`)
    const now = new Date().toISOString()
    const updated = validate({ ...catalog.bindings[index], lastSyncedGroupHashes: groupHashes, lastSyncedAt: now, lastSyncStatus: 'succeeded', updatedAt: now })
    const bindings = [...catalog.bindings]; bindings[index] = updated
    await writeJsonAtomic(this.filePath, { schemaVersion: 1, bindings })
    return updated
  }

  private async read(): Promise<GitBindingCatalog> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as GitBindingCatalog
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.bindings)) throw new Error('Invalid Git binding catalog')
      return { schemaVersion: 1, bindings: parsed.bindings.map(validate) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      throw error
    }
  }
}
