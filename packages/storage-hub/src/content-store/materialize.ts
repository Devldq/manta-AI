import { constants } from 'node:fs'
import { copyFile, link as nodeLink, lstat, rename, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { assertContentHash, assertContainedPath, ensureSafeDirectory, hashFileSha256, type ContentObject, VolumeObjectStore } from './object-store'

export type MaterializationStrategy = 'reflink' | 'copy'
export interface MaterializeAssetOptions { volumeRoot: string; object: Pick<ContentObject, 'hash' | 'size'>; destination: string; replace?: { approved: true; expectedHash: string }; reflink?: (source: string, destination: string) => Promise<void> }
export interface MaterializeAssetResult { hash: string; size: number; path: string; strategy: MaterializationStrategy }
function validateDestination(root: string, destination: string): string { const value = resolve(destination); assertContainedPath(root, value, 'Materialized asset destination escapes its volume'); const first = value.slice(resolve(root).length).replace(/^[\\/]+/, '').split(/[\\/]/)[0]; if (['.ash', '.git', 'config', 'secrets', 'work', 'diagnostics', 'cache'].includes(first ?? '') || /(?:\.(?:db|sqlite|sqlite3)|-(?:wal|shm))$/i.test(basename(value))) throw new Error('Materialized asset destination is mutable storage'); return value }
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
function canFallback(error: unknown): boolean { return ['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '') }

/** Materializes a verified immutable object without silently replacing user or mutable files. */
export async function materializeAsset(options: MaterializeAssetOptions): Promise<MaterializeAssetResult> {
  assertContentHash(options.object.hash); const root = resolve(options.volumeRoot); const destination = validateDestination(root, options.destination); const objects = new VolumeObjectStore(root); const source = await objects.verify(options.object.hash)
  if (source.size !== options.object.size) throw new Error('Requested object size does not match the verified CAS object')
  const hadDestination = await exists(destination)
  if (hadDestination && !options.replace?.approved) throw new Error('Materialized asset destination already exists; explicit approved replacement is required')
  if (hadDestination) { assertContentHash(options.replace!.expectedHash); const old = await hashFileSha256(destination); if (old.hash !== options.replace!.expectedHash) throw new Error('Existing destination changed and no longer matches the approved replacement hash') }
  await ensureSafeDirectory(root, dirname(destination)); const temporary = resolve(dirname(destination), `.${basename(destination)}.${crypto.randomUUID()}.tmp`); let strategy: MaterializationStrategy
  try {
    try { await (options.reflink ?? ((from, to) => copyFile(from, to, constants.COPYFILE_FICLONE_FORCE)))(source.path, temporary); strategy = 'reflink' }
    catch (error) {
      if (!canFallback(error)) throw error
      await rm(temporary, { force: true }); await copyFile(source.path, temporary, constants.COPYFILE_EXCL); strategy = 'copy'
    }
    const written = await hashFileSha256(temporary); if (written.hash !== source.hash || written.size !== source.size) throw new Error('Materialized asset verification failed')
    if (hadDestination) { const current = await hashFileSha256(destination); if (current.hash !== options.replace!.expectedHash) throw new Error('Existing destination changed before replacement'); await rename(temporary, destination) }
    else { try { await nodeLink(temporary, destination) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Materialized asset destination already exists; explicit approved replacement is required'); throw error } }
    const result = await hashFileSha256(destination); if (result.hash !== source.hash || result.size !== source.size) throw new Error('Materialized asset final verification failed')
    return { hash: source.hash, size: source.size, path: destination, strategy }
  } finally { await rm(temporary, { force: true }) }
}
