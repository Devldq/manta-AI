import { dirname } from 'node:path'
import type { AssetManifest, ContentObject } from '@manta/storage-hub'
import { createContentAssetService, type PackageAssetInput } from './content-assets'
import { rollbackCompletedExtensionInstall, transactionalInstallDirectory } from './extension-transactions'

export interface ImmutableExtensionInstallOptions extends Omit<PackageAssetInput, 'sourceRoot'> {
  extensionsRoot: string
  source: string
  destination: string
  registryWrites?: Map<string, string>
  validate?: (stagedPath: string) => void
  snapshotPackage?: (input: PackageAssetInput) => Promise<{ manifest: Required<AssetManifest>; objects: ContentObject[] }>
}

export async function installImmutableExtensionPackage(options: ImmutableExtensionInstallOptions) {
  const transaction = transactionalInstallDirectory({
    extensionsRoot: options.extensionsRoot,
    source: options.source,
    destination: options.destination,
    registryWrites: options.registryWrites,
    validate: options.validate,
  })
  try {
    const snapshot = await (options.snapshotPackage ?? createContentAssetService({ volumeRoot: dirname(options.extensionsRoot) }).snapshotPackage)({
      kind: options.kind,
      logicalId: options.logicalId,
      version: options.version,
      sourceRoot: options.destination,
    })
    return { ...transaction, ...snapshot }
  } catch (snapshotError) {
    try {
      rollbackCompletedExtensionInstall({
        extensionsRoot: options.extensionsRoot,
        destination: options.destination,
        transactionId: transaction.transactionId,
        registryPaths: [...(options.registryWrites?.keys() ?? [])],
      })
    } catch (rollbackError) {
      throw new AggregateError([snapshotError, rollbackError], 'Extension snapshot failed and the completed install could not be rolled back')
    }
    throw snapshotError
  }
}
