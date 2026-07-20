import { access, lstat, mkdir, readFile, readdir, rename, rmdir } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import {
  acquireMigrationFileLock,
  isWindowsPath,
  MigrationFileLockError,
  type MigrationFileLock,
  type MigrationLockOptions,
} from '@manta/storage-hub'
import {
  ASH_VOLUME_DIR_NAME,
  LEGACY_ASH_VOLUME_DIR_NAME,
  type AshBootstrap,
} from '@manta/shared'

const ROOT_LOCK_BASENAME = `.${ASH_VOLUME_DIR_NAME}.root`
const DEFAULT_LOCK_WAIT_MS = 30_000

type AcquireLock = (path: string, options?: boolean | MigrationLockOptions) => Promise<MigrationFileLock>

export interface LegacyVolumeUpgradeOptions {
  acquireLock?: AcquireLock
  inspectProcess?: MigrationLockOptions['inspectProcess']
  lockWaitMs?: number
  afterTargetReservation?: (target: string) => Promise<void>
  renameVolumeRoot?: (source: string, target: string) => Promise<void>
}

export class LegacyVolumeUpgradeError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'LegacyVolumeUpgradeError'
    if (options && 'cause' in options) (this as Error & { cause?: unknown }).cause = options.cause
  }
}

interface FileIdentity { dev: number | bigint; ino: number | bigint }
interface LegacySnapshot {
  root: FileIdentity
  manifest: FileIdentity
  manifestText: string
  volumeId: string
}

export interface LegacyVolumeUpgradePaths {
  flavor: 'windows' | 'posix'
  legacyRoot: string
  currentRoot: string
  lockPath: string
}

function joinForParent(parentPath: string, name: string): string {
  return isWindowsPath(parentPath) ? win32.join(parentPath, name) : posix.join(parentPath, name)
}

export function legacyVolumeUpgradePaths(parentPath: string): LegacyVolumeUpgradePaths {
  const flavor = isWindowsPath(parentPath) ? 'windows' : 'posix'
  const lockTarget = joinForParent(parentPath, ROOT_LOCK_BASENAME)
  return {
    flavor,
    legacyRoot: joinForParent(parentPath, LEGACY_ASH_VOLUME_DIR_NAME),
    currentRoot: joinForParent(parentPath, ASH_VOLUME_DIR_NAME),
    lockPath: `${lockTarget}.migration.lock`,
  }
}

function lockTargetPath(parentPath: string): string {
  return joinForParent(parentPath, ROOT_LOCK_BASENAME)
}

export function volumeRootLockPath(parentPath: string): string {
  return legacyVolumeUpgradePaths(parentPath).lockPath
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

function identity(value: { dev: number | bigint; ino: number | bigint }): FileIdentity {
  return { dev: value.dev, ino: value.ino }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function renameVolumeRootDefault(source: string, target: string): Promise<void> {
  await rename(source, target)
}

function lockOptions(options: LegacyVolumeUpgradeOptions, breakStale: boolean): MigrationLockOptions {
  return {
    breakStale,
    inspectProcess: options.inspectProcess,
    waitTimeoutMs: breakStale ? 0 : options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    retryDelayMs: 10,
  }
}

async function acquireVolumeRootLock(parentPath: string, options: LegacyVolumeUpgradeOptions): Promise<MigrationFileLock> {
  const acquire = options.acquireLock ?? acquireMigrationFileLock
  const target = lockTargetPath(parentPath)
  try {
    return await acquire(target, lockOptions(options, true))
  } catch (firstError) {
    if (firstError instanceof MigrationFileLockError && firstError.code === 'UNKNOWN_OWNER') {
      throw new LegacyVolumeUpgradeError('VOLUME_ROOT_LOCKED', `Volume root lock has an unknown owner and cannot be recovered safely: ${volumeRootLockPath(parentPath)}`, { cause: firstError })
    }
    if (!(firstError instanceof MigrationFileLockError) || firstError.code !== 'LOCK_HELD') throw firstError
    try {
      return await acquire(target, lockOptions(options, false))
    } catch (waitError) {
      if (!(waitError instanceof MigrationFileLockError) || !['LOCK_HELD', 'UNKNOWN_OWNER'].includes(waitError.code)) throw waitError
      throw new LegacyVolumeUpgradeError('VOLUME_ROOT_LOCKED', `Unable to acquire the volume root lock for ${parentPath}`, { cause: new AggregateError([firstError, waitError]) })
    }
  }
}

async function captureLegacySnapshot(legacyRoot: string, expectedVolumeId?: string): Promise<LegacySnapshot> {
  const manifestPath = joinForParent(legacyRoot, 'ash-volume.json')
  let rootMetadata
  let manifestMetadata
  let manifestText: string
  try {
    [rootMetadata, manifestMetadata, manifestText] = await Promise.all([
      lstat(legacyRoot),
      lstat(manifestPath),
      readFile(manifestPath, 'utf8'),
    ])
  } catch (error) {
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_INVALID', `Legacy storage root is missing a readable manifest: ${legacyRoot}`, { cause: error })
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_INVALID', `Legacy storage root or manifest is not a regular ASH directory: ${legacyRoot}`)
  }
  let manifest: { schemaVersion?: unknown; volumeId?: unknown }
  try { manifest = JSON.parse(manifestText) as typeof manifest }
  catch (error) { throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_INVALID', `Legacy storage manifest is invalid JSON: ${manifestPath}`, { cause: error }) }
  if (manifest.schemaVersion !== 1 || typeof manifest.volumeId !== 'string' || !manifest.volumeId) {
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_INVALID', `Legacy storage manifest is not a supported ASH volume: ${manifestPath}`)
  }
  if (expectedVolumeId && manifest.volumeId !== expectedVolumeId) {
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_ID_MISMATCH', `Legacy storage manifest ${manifest.volumeId} does not match Bootstrap volume ${expectedVolumeId}`)
  }
  return { root: identity(rootMetadata), manifest: identity(manifestMetadata), manifestText, volumeId: manifest.volumeId }
}

async function verifyRenamedLegacyRoot(legacyRoot: string, currentRoot: string, snapshot: LegacySnapshot): Promise<void> {
  if (await pathExists(legacyRoot)) throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_VERIFICATION_FAILED', `Legacy storage root still exists after rename: ${legacyRoot}`)
  try {
    const [rootMetadata, manifestMetadata, manifestText] = await Promise.all([
      lstat(currentRoot),
      lstat(joinForParent(currentRoot, 'ash-volume.json')),
      readFile(joinForParent(currentRoot, 'ash-volume.json'), 'utf8'),
    ])
    const manifest = JSON.parse(manifestText) as { schemaVersion?: unknown; volumeId?: unknown }
    if (!sameIdentity(snapshot.root, identity(rootMetadata))
      || !sameIdentity(snapshot.manifest, identity(manifestMetadata))
      || manifestText !== snapshot.manifestText
      || manifest.schemaVersion !== 1
      || manifest.volumeId !== snapshot.volumeId) {
      throw new Error('renamed root or manifest identity changed')
    }
  } catch (error) {
    if (error instanceof LegacyVolumeUpgradeError) throw error
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_VERIFICATION_FAILED', `Renamed legacy storage did not preserve its root and manifest identity: ${currentRoot}`, { cause: error })
  }
}

async function verifyEmptyReservation(path: string, expected: FileIdentity): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !sameIdentity(expected, identity(metadata)) || (await readdir(path)).length !== 0) {
    throw new Error('target reservation was replaced or modified')
  }
}

async function removeOwnedEmptyReservation(path: string, expected: FileIdentity): Promise<boolean> {
  try {
    await verifyEmptyReservation(path, expected)
    await rmdir(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return false
  }
}

async function prepareVolumeRootUnderLock(
  parentPath: string,
  expectedVolumeId: string | undefined,
  options: LegacyVolumeUpgradeOptions,
): Promise<string> {
  const { flavor, legacyRoot, currentRoot } = legacyVolumeUpgradePaths(parentPath)
  const [legacyExists, currentExists] = await Promise.all([pathExists(legacyRoot), pathExists(currentRoot)])
  if (legacyExists && currentExists) {
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_CONFLICT', `Both ${legacyRoot} and ${currentRoot} exist; refusing to overwrite or merge either storage directory`)
  }
  if (!legacyExists) return currentRoot

  const snapshot = await captureLegacySnapshot(legacyRoot, expectedVolumeId)
  let reservation: FileIdentity
  try {
    await mkdir(currentRoot)
    reservation = identity(await lstat(currentRoot))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_CONFLICT', `Storage target appeared while upgrading ${legacyRoot}; refusing to replace ${currentRoot}`, { cause: error })
    }
    throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_UPGRADE_FAILED', `Unable to reserve ${currentRoot} for the legacy volume upgrade`, { cause: error })
  }

  try {
    await options.afterTargetReservation?.(currentRoot)
    await verifyEmptyReservation(currentRoot, reservation)
    // POSIX rename may replace an empty directory, so the verified directory is
    // our namespace reservation. Windows rename is no-replace; release our own
    // reservation immediately before it and let a late external target win.
    if (flavor === 'windows') await rmdir(currentRoot)
    await (options.renameVolumeRoot ?? renameVolumeRootDefault)(legacyRoot, currentRoot)
  } catch (renameError) {
    try { await verifyRenamedLegacyRoot(legacyRoot, currentRoot, snapshot) }
    catch (verificationError) {
      await removeOwnedEmptyReservation(currentRoot, reservation)
      if (await pathExists(legacyRoot) && await pathExists(currentRoot)) {
        throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_CONFLICT', `Storage target appeared or changed while upgrading ${legacyRoot}; refusing to replace ${currentRoot}`, { cause: new AggregateError([renameError, verificationError]) })
      }
      throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_UPGRADE_FAILED', `Unable to atomically rename ${legacyRoot} to ${currentRoot}`, { cause: new AggregateError([renameError, verificationError]) })
    }
    return currentRoot
  }
  await verifyRenamedLegacyRoot(legacyRoot, currentRoot, snapshot)
  return currentRoot
}

export async function withPreparedVolumeRoot<T>(
  parentPath: string,
  operation: (rootPath: string) => Promise<T>,
  options: LegacyVolumeUpgradeOptions & { expectedVolumeId?: string } = {},
): Promise<T> {
  const lock = await acquireVolumeRootLock(parentPath, options)
  let primaryFailed = false
  try {
    const rootPath = await prepareVolumeRootUnderLock(parentPath, options.expectedVolumeId, options)
    return await operation(rootPath)
  } catch (error) {
    primaryFailed = true
    throw error
  } finally {
    try { await lock.release() }
    catch (releaseError) {
      if (!primaryFailed) throw new LegacyVolumeUpgradeError('VOLUME_ROOT_LOCK_RELEASE_FAILED', `Unable to release the volume root lock for ${parentPath}`, { cause: releaseError })
    }
  }
}

export async function upgradeBootstrapVolumeDirectories(...bootstraps: AshBootstrap[]): Promise<void> {
  const parents = new Map<string, string>()
  for (const bootstrap of bootstraps) {
    for (const volume of bootstrap.volumes) {
      // Exact-directory records already point at their final root and must not
      // be reinterpreted as a legacy parent directory during startup.
      if (!volume.rootPath && !parents.has(volume.parentPath)) parents.set(volume.parentPath, volume.id)
    }
  }
  for (const [parentPath, volumeId] of parents) {
    const { legacyRoot, currentRoot } = legacyVolumeUpgradePaths(parentPath)
    const [legacyExists, currentExists] = await Promise.all([pathExists(legacyRoot), pathExists(currentRoot)])
    if (legacyExists && currentExists) {
      throw new LegacyVolumeUpgradeError('LEGACY_VOLUME_CONFLICT', `Both ${legacyRoot} and ${currentRoot} exist; refusing to overwrite or merge either storage directory`)
    }
    if (!legacyExists && currentExists) continue
    await withPreparedVolumeRoot(parentPath, async () => undefined, { expectedVolumeId: volumeId })
  }
}
