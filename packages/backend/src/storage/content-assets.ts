import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, rename } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { assertContainedPath, AssetManifestStore, ensureSafeDirectory, type AssetManifest, type ContentObject, VolumeObjectStore } from '@manta/storage-hub'

export interface ContentAssetServiceOptions {
  volumeRoot: string
  trustedStagingRoot?: string
  beforePublish?: (assetId: string) => void | Promise<void>
}

export interface DocumentAssetInput { documentId: string; source: string; name: string }
export interface PackageAssetInput { kind: 'skill' | 'plugin' | 'marketplace'; logicalId: string; version: string; sourceRoot: string }
export interface ContentAssetSnapshot { object: ContentObject; manifest: Required<AssetManifest> }
export interface PreparedContentAsset extends ContentAssetSnapshot { rollback(): Promise<void> }

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/
const forbiddenPackageDirectories = new Set(['.git', 'node_modules'])

function assertLogicalId(value: string, label: string): void {
  if (!ID.test(value)) throw new Error(`${label} must be a stable filesystem-safe identifier`)
}

function safeLeaf(value: string): string {
  const leaf = basename(value.replaceAll('\\', '/')).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 160)
  return leaf || 'document'
}

async function collectPackageFiles(root: string): Promise<Array<{ absolute: string; relative: string }>> {
  const files: Array<{ absolute: string; relative: string }> = []
  const visit = async (current: string, relativePath: string): Promise<void> => {
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`Immutable package contains a symbolic link or reparse point: ${relativePath || basename(current)}`)
    if (stat.isDirectory()) {
      if (relativePath && forbiddenPackageDirectories.has(basename(current))) throw new Error(`Immutable package contains forbidden internal directory: ${relativePath}`)
      for (const name of (await readdir(current)).sort()) await visit(resolve(current, name), relativePath ? `${relativePath}/${name}` : name)
      return
    }
    if (!stat.isFile()) throw new Error(`Immutable package contains a non-file entry: ${relativePath}`)
    files.push({ absolute: current, relative: relativePath })
  }
  await visit(resolve(root), '')
  return files
}

export function createContentAssetService(options: ContentAssetServiceOptions) {
  const volumeRoot = resolve(options.volumeRoot)
  const objects = new VolumeObjectStore(volumeRoot)
  const manifests = new AssetManifestStore(volumeRoot)
  const ingestDocument = (source: string) => options.trustedStagingRoot
    ? objects.ingestStagedFile(source, options.trustedStagingRoot)
    : objects.ingestFile(source)

  const publish = async (assetId: string, entries: AssetManifest['entries']): Promise<{ manifest: Required<AssetManifest>; created: boolean }> => {
    try {
      const current = await manifests.read(assetId)
      const matches = current.entries.length === entries.length && current.entries.every((entry, index) => {
        const expected = entries[index]
        return expected && entry.path === expected.path && entry.hash === expected.hash && entry.size === expected.size
      })
      if (!matches) throw new Error(`Asset ${assetId} already exists with different immutable content`)
      return { manifest: current, created: false }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await options.beforePublish?.(assetId)
    try { return { manifest: await manifests.write({ assetId, entries }), created: true } }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const current = await manifests.read(assetId)
      const matches = current.entries.length === entries.length && current.entries.every((entry, index) => entry.path === entries[index]?.path && entry.hash === entries[index]?.hash && entry.size === entries[index]?.size)
      if (!matches) throw new Error(`Asset ${assetId} already exists with different immutable content`)
      return { manifest: current, created: false }
    }
  }

  const snapshotDocumentInternal = async (input: DocumentAssetInput): Promise<ContentAssetSnapshot & { created: boolean }> => {
    assertLogicalId(input.documentId, 'Document ID')
    const object = await ingestDocument(input.source)
    const assetId = `document.${input.documentId}`
    const published = await publish(assetId, [{ path: `knowledge/documents/${safeLeaf(input.name)}`, hash: object.hash, size: object.size }])
    return { object, ...published }
  }

  return {
    async publishDocumentObject(input: { documentId: string; name: string; object: ContentObject }): Promise<PreparedContentAsset> {
      assertLogicalId(input.documentId, 'Document ID')
      const published = await publish(`document.${input.documentId}`, [{ path: `knowledge/documents/${safeLeaf(input.name)}`, hash: input.object.hash, size: input.object.size }])
      return { object: input.object, manifest: published.manifest, async rollback() { if (published.created) await manifests.remove(published.manifest.assetId, { createdAt: published.manifest.createdAt }) } }
    },
    async stageDocument(input: DocumentAssetInput): Promise<{ object: ContentObject; publish(): Promise<PreparedContentAsset> }> {
      assertLogicalId(input.documentId, 'Document ID')
      const object = await ingestDocument(input.source)
      return { object, async publish() { return createContentAssetService(options).publishDocumentObject({ documentId: input.documentId, name: input.name, object }) } }
    },
    async prepareDocument(input: DocumentAssetInput): Promise<PreparedContentAsset> {
      const { created, ...snapshot } = await snapshotDocumentInternal(input)
      return {
        ...snapshot,
        async rollback() {
          if (created) await manifests.remove(snapshot.manifest.assetId, { createdAt: snapshot.manifest.createdAt })
        },
      }
    },

    async snapshotDocument(input: DocumentAssetInput): Promise<ContentAssetSnapshot> {
      const { rollback: _rollback, ...snapshot } = await this.prepareDocument(input)
      return snapshot
    },

    async snapshotPackage(input: PackageAssetInput): Promise<{ manifest: Required<AssetManifest>; objects: ContentObject[] }> {
      assertLogicalId(input.logicalId, 'Package logical ID')
      if (!input.version || input.version.length > 64) throw new Error('Package version is required')
      const sourceRoot = resolve(input.sourceRoot)
      const rootStat = await lstat(sourceRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Immutable package root must be an ordinary directory')
      const files = await collectPackageFiles(sourceRoot)
      const ingested: ContentObject[] = []
      const entries: AssetManifest['entries'] = []
      for (const file of files) {
        const object = await objects.ingestFile(file.absolute); ingested.push(object)
        entries.push({ path: `packages/${input.kind}/${input.logicalId}/${file.relative}`, hash: object.hash, size: object.size })
      }
      const identity = createHash('sha256').update(input.version).update('\0')
      for (const entry of entries) identity.update(entry.path).update('\0').update(entry.hash).update('\0')
      const assetId = `${input.kind}.${input.logicalId}.${identity.digest('hex').slice(0, 16)}`
      const published = await publish(assetId, entries)
      return { manifest: published.manifest, objects: ingested }
    },

    async migrateLegacyDocuments(inputs: DocumentAssetInput[]): Promise<{ manifests: Required<AssetManifest>[]; retiredSources: string[] }> {
      const uniqueSources = [...new Set(inputs.map((input) => resolve(input.source)))]
      for (const source of uniqueSources) {
        const legacyRoot = resolve(volumeRoot, 'knowledge', 'documents')
        assertContainedPath(legacyRoot, source, 'Legacy document must be below the active knowledge documents root')
        await ensureSafeDirectory(volumeRoot, dirname(source))
        const stat = await lstat(source)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Legacy document must be an ordinary file')
      }
      const created: Array<{ assetId: string; createdAt: string }> = []
      const snapshots: ContentAssetSnapshot[] = []
      try {
        for (const input of inputs) {
          const snapshot = await snapshotDocumentInternal(input); snapshots.push(snapshot)
          if (snapshot.created) created.push({ assetId: snapshot.manifest.assetId, createdAt: snapshot.manifest.createdAt })
        }
        for (const snapshot of snapshots) await manifests.read(snapshot.manifest.assetId)
      } catch (error) {
        await Promise.all(created.map((item) => manifests.remove(item.assetId, { createdAt: item.createdAt })))
        throw error
      }

      const backupRoot = resolve(volumeRoot, '.ash-backups', 'content-migration', randomUUID())
      const retired: Array<{ source: string; backup: string }> = []
      try {
        await ensureSafeDirectory(volumeRoot, backupRoot)
        for (const [index, source] of uniqueSources.entries()) {
          const backup = resolve(backupRoot, `${index}-${basename(source)}`)
          await rename(source, backup); retired.push({ source, backup })
        }
      } catch (error) {
        for (const item of retired.reverse()) await rename(item.backup, item.source)
        await Promise.all(created.map((item) => manifests.remove(item.assetId, { createdAt: item.createdAt })))
        throw error
      }
      return { manifests: snapshots.map((snapshot) => snapshot.manifest), retiredSources: retired.map((item) => item.backup) }
    },
  }
}
