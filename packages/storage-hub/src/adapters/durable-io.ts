import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, rm, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'

export type DurableIoEvent = 'staging-file-fsynced' | 'exclusive-file-fsynced' | 'atomic-rename-complete' | 'parent-directory-fsynced' | 'parent-directory-fsync-unsupported'
export type DurableIoObserver = (event: DurableIoEvent) => void

async function syncDirectory(path: string): Promise<boolean> {
  let handle
  try { handle = await open(path, 'r'); await handle.sync(); return true } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(code ?? '')) throw error
    return false
  } finally { await handle?.close() }
}

export async function ensureDirectoryDurable(path: string): Promise<void> {
  const absolute = resolve(path); const filesystemRoot = parse(absolute).root; let current = filesystemRoot
  for (const part of absolute.slice(filesystemRoot.length).split(sep).filter(Boolean)) {
    const next = join(current, part); let created = false
    try { const stat = await lstat(next); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Durable adapter directory path contains a link or non-directory') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await mkdir(next); created = true } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; const stat = await lstat(next); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Durable adapter directory path changed during creation') }
    }
    if (created) await syncDirectory(current); await syncDirectory(next); current = next
  }
}

async function stagingWrite(target: string, bytes: Uint8Array, observe?: DurableIoObserver): Promise<string> {
  await ensureDirectoryDurable(dirname(target)); const staging = join(dirname(target), `${basename(target)}.${randomUUID()}.tmp`); const handle = await open(staging, 'wx')
  try { await handle.writeFile(bytes); await handle.sync(); observe?.('staging-file-fsynced') } catch (error) { await handle.close(); await rm(staging, { force: true }); throw error }
  await handle.close(); return staging
}

async function publish(target: string, bytes: Uint8Array, observe?: DurableIoObserver): Promise<void> {
  const staging = await stagingWrite(target, bytes, observe)
  try {
    await rename(staging, target); observe?.('atomic-rename-complete'); const synced = await syncDirectory(dirname(target)); observe?.(synced ? 'parent-directory-fsynced' : 'parent-directory-fsync-unsupported')
  } catch (error) { await rm(staging, { force: true }); throw error }
}

export async function writeNewBytesDurable(target: string, bytes: Uint8Array, observe?: DurableIoObserver): Promise<void> {
  await ensureDirectoryDurable(dirname(target)); let handle
  try {
    handle = await open(target, 'wx'); await handle.writeFile(bytes); await handle.sync(); observe?.('exclusive-file-fsynced'); await handle.close(); handle = undefined
    const synced = await syncDirectory(dirname(target)); observe?.(synced ? 'parent-directory-fsynced' : 'parent-directory-fsync-unsupported')
  } catch (error) { await handle?.close(); if (handle) await rm(target, { force: true }); throw error }
}

export async function createExclusiveClaimDurable(target: string, bytes: Uint8Array, observe?: DurableIoObserver): Promise<string> {
  let handle
  try {
    handle = await open(target, 'wx'); await handle.writeFile(bytes); const stat = await handle.stat({ bigint: true }); await handle.sync(); observe?.('exclusive-file-fsynced'); await handle.close(); handle = undefined
    const synced = await syncDirectory(dirname(target)); observe?.(synced ? 'parent-directory-fsynced' : 'parent-directory-fsync-unsupported')
    return `${stat.dev.toString(16)}-${stat.ino.toString(16)}-${stat.birthtimeNs.toString(16)}`
  } catch (error) { await handle?.close(); if (handle) await rm(target, { force: true }); throw error }
}

export async function createExclusiveDirectoryDurable(target: string): Promise<void> {
  await mkdir(target); await syncDirectory(dirname(target)); await syncDirectory(target)
}

export async function removeEmptyDirectoryDurable(target: string): Promise<void> {
  await rmdir(target); await syncDirectory(dirname(target))
}

export async function renameDurable(source: string, target: string): Promise<void> {
  if (dirname(source) !== dirname(target)) throw new Error('Durable rename must stay within one directory')
  await rename(source, target); await syncDirectory(dirname(target))
}

export async function unlinkDurable(target: string): Promise<void> {
  await unlink(target); await syncDirectory(dirname(target))
}

export async function writeJsonDurable(target: string, value: unknown, observe?: DurableIoObserver): Promise<void> {
  await publish(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'), observe)
}

export async function restoreBytesDurable(target: string, bytes: Uint8Array, validatePath: () => Promise<void>): Promise<void> {
  await validatePath(); const staging = await stagingWrite(target, bytes)
  try { await validatePath(); await rename(staging, target); await syncDirectory(dirname(target)); await validatePath() } catch (error) { await rm(staging, { force: true }); throw error }
}
