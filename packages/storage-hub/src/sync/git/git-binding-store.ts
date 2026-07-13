import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from '../../bootstrap/atomic-json'
import type { GitBinding } from './types'

interface GitBindingCatalog { schemaVersion: 1; bindings: GitBinding[] }
const empty = (): GitBindingCatalog => ({ schemaVersion: 1, bindings: [] })

function validate(binding: GitBinding): GitBinding {
  if (!binding.volumeId || !binding.repositoryPath || !binding.mode || !binding.createdAt || !binding.updatedAt) throw new Error('Invalid Git binding')
  if (binding.mode === 'remote' && !binding.remoteUrl) throw new Error('Remote Git binding requires a remote URL')
  if (binding.remoteUrl && /:\/\/[^\s/@:]+:[^\s/@]+@/.test(binding.remoteUrl)) throw new Error('Git remote URLs must not contain credentials')
  if (binding.credentialRef?.trim() === '') throw new Error('Git credential reference must not be empty')
  return binding
}

export class GitBindingStore {
  constructor(readonly filePath: string) {}

  async list(): Promise<GitBinding[]> { return (await this.read()).bindings.map(validate) }
  async get(volumeId: string): Promise<GitBinding | undefined> { return (await this.list()).find((item) => item.volumeId === volumeId) }

  async bind(binding: GitBinding): Promise<GitBinding> {
    const valid = validate(binding); const catalog = await this.read(); const existing = catalog.bindings.find((item) => item.volumeId === valid.volumeId)
    if (existing) {
      if (existing.repositoryPath !== valid.repositoryPath || existing.mode !== valid.mode || existing.remoteUrl !== valid.remoteUrl || existing.credentialRef !== valid.credentialRef) throw new Error(`Volume ${valid.volumeId} already has a Git binding`)
      return existing
    }
    await writeJsonAtomic(this.filePath, { schemaVersion: 1, bindings: [...catalog.bindings, valid] })
    return valid
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
