import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CreateSkillInput, SkillDefinition, SkillMetadata, UpdateSkillInput } from '@manta/shared'
import type { ScannedSkill } from '../core/storage/skill/scanner'
import { bindPreparedSkillPackage, listSkillPackageClaims, prepareSkillCreation, prepareSkillUpdate } from '../core/storage/skill/store'
import { installImmutableExtensionPackage, type ImmutableExtensionInstallOptions } from './immutable-extension-install'
import { safeStorageSegment } from './path-routing'

export interface ImportSkillPackageOptions {
  extensionsRoot: string
  scanned: ScannedSkill
  existing?: SkillDefinition | null
  overwrite?: boolean
  snapshotPackage?: ImmutableExtensionInstallOptions['snapshotPackage']
}

export function validateSkillPackagePath(packagePath: unknown, platform: NodeJS.Platform = process.platform): string {
  if (typeof packagePath !== 'string' || !packagePath || isAbsolute(packagePath) || packagePath.includes('\\')) throw new Error('Invalid Skill packagePath: expected a root-relative POSIX path')
  const segments = packagePath.split('/')
  if (segments.length < 2 || comparisonPath(segments[0], platform) !== comparisonPath('skills', platform)) throw new Error('Invalid Skill packagePath: package must be inside skills')
  for (const segment of segments) safeStorageSegment(segment)
  const normalized = segments.join('/')
  if (comparisonPath(normalized, platform) === comparisonPath('skills/imported', platform)) throw new Error('Reserved Skill package container cannot be claimed: skills/imported')
  return normalized
}

function comparisonPath(packagePath: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? packagePath.toLowerCase() : packagePath
}

function pathsOverlap(left: string, right: string): boolean {
  const a = comparisonPath(left); const b = comparisonPath(right)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

function assertUnclaimedPackageTree(packagePath: string, skillId: string, existing: boolean): void {
  for (const claim of listSkillPackageClaims()) {
    let claimedPath: string
    try { claimedPath = validateSkillPackagePath(claim.packagePath) } catch (error) { throw new Error(`Malformed persisted Skill packagePath for ${claim.id}: ${String(error)}`) }
    if (existing && claim.id === skillId && claimedPath === packagePath) continue
    if (pathsOverlap(packagePath, claimedPath)) throw new Error(`Skill package claim overlaps ${claim.id}: ${claimedPath}`)
  }
}

function destinationFor(extensionsRoot: string, packagePath: string): string {
  const validated = validateSkillPackagePath(packagePath)
  const destination = resolve(extensionsRoot, ...validated.split('/'))
  const rel = relative(resolve(extensionsRoot), destination)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill packagePath resolves outside extensions')
  return destination
}

function managedSourcePath(extensionsRoot: string, sourceRoot: string): string | null {
  const skillsRoot = resolve(extensionsRoot, 'skills')
  const rel = relative(skillsRoot, resolve(sourceRoot))
  if (!rel) throw new Error('Reserved Skill package container cannot be claimed: skills')
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return validateSkillPackagePath(['skills', ...rel.split(sep)].join('/'))
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
  const sourceClaim = managedSourcePath(options.extensionsRoot, sourceRoot)

  const basePrepared = options.existing
    ? prepareSkillUpdate(options.existing.id, updateInput(options.scanned))
    : prepareSkillCreation(createInput(options.scanned))
  if (!basePrepared) throw new Error(`Existing skill registry is missing: ${options.existing?.id}`)

  let packagePath: string
  if (options.existing) {
    if (basePrepared.definition.packagePath) packagePath = validateSkillPackagePath(basePrepared.definition.packagePath)
    else if (sourceClaim) packagePath = sourceClaim
    else throw new Error('Legacy Skill has no packagePath; external overwrite cannot guess its managed destination')
  } else {
    packagePath = sourceClaim ?? `skills/imported/${safeStorageSegment(basePrepared.definition.id)}`
  }
  const prepared = bindPreparedSkillPackage(basePrepared, packagePath)
  const destination = destinationFor(options.extensionsRoot, packagePath)
  const sameLocation = resolve(sourceRoot) === resolve(destination)
  if (!sameLocation && existsSync(destination) && !options.existing) {
    throw new Error(`Skill destination collision: ${destination} already exists`)
  }

  await installImmutableExtensionPackage({
    extensionsRoot: options.extensionsRoot,
    source: sourceRoot,
    destination,
    kind: 'skill',
    logicalId: prepared.definition.id,
    version: options.scanned.version || '1.0.0',
    validate: (stagedPath) => {
      if (!existsSync(join(stagedPath, 'SKILL.md'))) throw new Error('Skill package must contain SKILL.md at its root')
      assertUnclaimedPackageTree(packagePath, prepared.definition.id, Boolean(options.existing))
    },
    registryWrites: new Map([[prepared.filePath, JSON.stringify(prepared.definition, null, 2)]]),
    snapshotPackage: options.snapshotPackage,
  })
  return prepared.definition
}
