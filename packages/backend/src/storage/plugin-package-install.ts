import type { PluginManifest } from '@manta/shared'
import { preparePluginRegistration } from '../core/storage/plugin/store'
import { installImmutableExtensionPackage, type ImmutableExtensionInstallOptions } from './immutable-extension-install'

export interface InstallPluginPackageOptions {
  extensionsRoot: string
  source: string
  destination: string
  manifest: PluginManifest
  validate?: (stagedPath: string) => void
  snapshotPackage?: ImmutableExtensionInstallOptions['snapshotPackage']
}

export async function installPluginPackage(options: InstallPluginPackageOptions) {
  const prepared = preparePluginRegistration(options.manifest, options.destination)
  await installImmutableExtensionPackage({
    extensionsRoot: options.extensionsRoot,
    source: options.source,
    destination: options.destination,
    kind: 'plugin',
    logicalId: prepared.definition.id,
    version: options.manifest.version,
    validate: options.validate,
    registryWrites: new Map([[prepared.filePath, JSON.stringify(prepared.definition, null, 2)]]),
    snapshotPackage: options.snapshotPackage,
  })
  return prepared.definition
}
