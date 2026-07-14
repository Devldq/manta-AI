import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { CreateSkillInput, SkillDefinition, SkillMetadata, UpdateSkillInput } from '@manta/shared'
import type { ScannedSkill } from '../core/storage/skill/scanner'
import { prepareSkillCreation, prepareSkillUpdate } from '../core/storage/skill/store'
import { installImmutableExtensionPackage, type ImmutableExtensionInstallOptions } from './immutable-extension-install'

export interface ImportSkillPackageOptions {
  extensionsRoot: string
  scanned: ScannedSkill
  existing?: SkillDefinition | null
  overwrite?: boolean
  snapshotPackage?: ImmutableExtensionInstallOptions['snapshotPackage']
}

function safeDirectoryIdentity(value: string): string {
  if (!value || value === '.' || value === '..' || basename(value) !== value || /[\0/\\]/.test(value)) {
    throw new Error(`Unsafe skill directory identity: ${value}`)
  }
  return value
}

function createInput(scanned: ScannedSkill): CreateSkillInput {
  return {
    metadata: {
      name: scanned.name,
      description: scanned.description,
      version: scanned.version || '1.0.0',
      type: scanned.type,
      source: (scanned.source as SkillMetadata['source']) || 'user',
      license: scanned.license,
      userInvocable: scanned.userInvocable ?? true,
      argumentHint: scanned.argumentHint,
    },
    content: scanned.content,
    tools: scanned.tools,
  }
}

function updateInput(scanned: ScannedSkill): UpdateSkillInput {
  return {
    metadata: {
      name: scanned.name,
      description: scanned.description,
      version: scanned.version || '1.0.0',
      type: scanned.type,
      source: (scanned.source as SkillMetadata['source']) || 'user',
      license: scanned.license,
      userInvocable: scanned.userInvocable ?? true,
      argumentHint: scanned.argumentHint,
    },
    content: scanned.content,
    tools: scanned.tools,
  }
}

/** Atomically install a scanned Skill package, registry record, and immutable snapshot. */
export async function importSkillPackage(options: ImportSkillPackageOptions): Promise<SkillDefinition> {
  if (options.existing && !options.overwrite) throw new Error(`Skill already exists: ${options.scanned.name}`)
  const sourceRoot = dirname(options.scanned.filePath)
  const destination = join(options.extensionsRoot, 'skills', safeDirectoryIdentity(options.scanned.dirName))
  const sameLocation = resolve(sourceRoot) === resolve(destination)
  if (!sameLocation && existsSync(destination) && !options.overwrite) {
    throw new Error(`Skill destination collision: ${destination} already exists`)
  }

  const prepared = options.existing
    ? prepareSkillUpdate(options.existing.id, updateInput(options.scanned))
    : prepareSkillCreation(createInput(options.scanned))
  if (!prepared) throw new Error(`Existing skill registry is missing: ${options.existing?.id}`)

  await installImmutableExtensionPackage({
    extensionsRoot: options.extensionsRoot,
    source: sourceRoot,
    destination,
    kind: 'skill',
    logicalId: prepared.definition.id,
    version: options.scanned.version || '1.0.0',
    validate: (stagedPath) => {
      if (!existsSync(join(stagedPath, 'SKILL.md'))) throw new Error('Skill package must contain SKILL.md at its root')
    },
    registryWrites: new Map([[prepared.filePath, JSON.stringify(prepared.definition, null, 2)]]),
    snapshotPackage: options.snapshotPackage,
  })
  return prepared.definition
}
