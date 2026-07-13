import { dirname } from 'node:path'
import type { AssetManifest, ContentObject } from '@manta/storage-hub'
import { createContentAssetService, type PackageAssetInput } from './content-assets'
import { withLeasedExtensionInstall } from './extension-transactions'

export interface ImmutableExtensionInstallOptions extends Omit<PackageAssetInput, 'sourceRoot'> {
  extensionsRoot: string
  source: string
  destination: string
  registryWrites?: Map<string, string>
  validate?: (stagedPath: string) => void
  snapshotPackage?: (input: PackageAssetInput) => Promise<{ manifest: Required<AssetManifest>; objects: ContentObject[] }>
}

export async function installImmutableExtensionPackage(options: ImmutableExtensionInstallOptions) {
  return withLeasedExtensionInstall({
    extensionsRoot: options.extensionsRoot,
    source: options.source,
    destination: options.destination,
    registryWrites: options.registryWrites,
    validate: options.validate,
  }, async (transaction) => {
    const snapshot = await (options.snapshotPackage ?? createContentAssetService({ volumeRoot: dirname(options.extensionsRoot) }).snapshotPackage)({
      kind: options.kind,
      logicalId: options.logicalId,
      version: options.version,
      sourceRoot: options.destination,
    })
    return { ...transaction, ...snapshot }
  })
}
