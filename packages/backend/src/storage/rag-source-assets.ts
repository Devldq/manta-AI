import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { RagSourceAssetSchema, type RagSourceAsset } from '@manta/contracts'
import { durableAtomicWrite, durableCopy, durableFsyncFile, durableMkdir } from './durable-atomic'

export type { RagSourceAsset } from '@manta/contracts'

const HASH = /^[a-f0-9]{64}$/

export class RagSourceAssetStore {
  constructor(private readonly root: string) {}

  promote(stagedPath: string, input: { sha256: string; name: string; mediaType: string; size: number }): RagSourceAsset {
    this.assertHash(input.sha256)
    const sourceHash = hashFile(stagedPath)
    if (sourceHash !== input.sha256) throw new Error('Staged RAG source hash changed before promotion')
    const source = this.contentPath(input.sha256)
    durableMkdir(this.root)
    if (!existsSync(source)) {
      try { durableCopy(stagedPath, source, { exclusive: true, expectedHash: input.sha256 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    durableFsyncFile(source, input.sha256)
    const metadataPath = this.metadataPath(input.sha256)
    if (existsSync(metadataPath)) {
      const current = this.parse(readFileSync(metadataPath, 'utf8'))
      if (current.sha256 !== input.sha256 || current.size !== input.size) throw new Error('Existing RAG source asset metadata does not match content')
      return current
    }
    const asset: RagSourceAsset = {
      version: 1,
      assetId: `source.${input.sha256}`,
      sha256: input.sha256,
      name: safeName(input.name),
      mediaType: input.mediaType || 'application/octet-stream',
      size: input.size,
      createdAt: new Date().toISOString(),
    }
    durableAtomicWrite(metadataPath, `${JSON.stringify(asset, null, 2)}\n`)
    return asset
  }

  async read(assetId: string): Promise<RagSourceAsset & { path: string }> {
    const hash = this.hashFromAssetId(assetId)
    const metadata = this.parse(await readFile(this.metadataPath(hash), 'utf8'))
    const path = this.contentPath(hash)
    if (!existsSync(path) || hashFile(path) !== metadata.sha256) throw new Error(`RAG source asset ${assetId} is missing or corrupt`)
    return { ...metadata, path }
  }

  createReadStream(assetId: string) { return createReadStream(this.contentPath(this.hashFromAssetId(assetId))) }

  private contentPath(hash: string): string { this.assertHash(hash); return join(this.root, hash) }
  private metadataPath(hash: string): string { this.assertHash(hash); return join(this.root, `${hash}.json`) }
  private hashFromAssetId(assetId: string): string { const hash = assetId.startsWith('source.') ? assetId.slice(7) : ''; this.assertHash(hash); return hash }
  private assertHash(hash: string): void { if (!HASH.test(hash)) throw new Error('RAG source asset requires a lowercase SHA-256 digest') }
  private parse(raw: string): RagSourceAsset {
    try { return RagSourceAssetSchema.parse(JSON.parse(raw)) }
    catch { throw new Error('RAG source asset metadata is invalid') }
  }
}

function safeName(input: string): string {
  const leaf = basename(input.replaceAll('\\', '/')).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 180)
  return leaf || 'document'
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function createRagSourceAssetStore(root: string): RagSourceAssetStore { return new RagSourceAssetStore(root) }
