import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import { closeSync, lstatSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'

type Release = () => void
const tails = new Map<string, Promise<void>>()
interface LeaseOwnershipFrame { key: string; token: symbol; active: boolean }
const leaseContext = new AsyncLocalStorage<readonly LeaseOwnershipFrame[]>()
const leaseKey = (root: string) => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)
const activeOwnership = (key: string) => leaseContext.getStore()?.some((frame) => frame.key === key && frame.active) === true

export function acquireVolumeContentStoreLeaseSync(volumeRoot: string): Release {
  const root = resolve(volumeRoot); const key = leaseKey(root)
  if (tails.has(key)) throw new Error('Content-store lock lease is busy')
  const ashPath = resolve(root, '.ash'); const lockPath = resolve(ashPath, 'content-store.lock')
  mkdirSync(ashPath, { recursive: true }); const ash = lstatSync(ashPath)
  if (!ash.isDirectory() || ash.isSymbolicLink()) throw new Error('Content-store lease directory is unsafe')
  let descriptor: number | undefined
  try { descriptor = openSync(lockPath, 'wx'); writeFileSync(descriptor, `${process.pid}\n`) }
  catch (error) { if (descriptor !== undefined) { closeSync(descriptor); try { unlinkSync(lockPath) } catch { /* future acquisition remains fail-closed */ } }; throw new Error('Content-store lock lease is busy or stale', { cause: error }) }
  const acquired = descriptor
  let released = false
  return () => { if (released) return; released = true; closeSync(acquired); try { unlinkSync(lockPath) } catch { /* fail closed on subsequent acquisition */ } }
}

export function withVolumeContentStoreLeaseSync<T>(volumeRoot: string, work: () => T): T {
  const key = leaseKey(volumeRoot)
  if (activeOwnership(key)) return work()
  const release = acquireVolumeContentStoreLeaseSync(volumeRoot)
  const frame: LeaseOwnershipFrame = { key, token: Symbol(key), active: true }
  try { return leaseContext.run([...(leaseContext.getStore() ?? []), frame], work) } finally { frame.active = false; release() }
}

/** Serializes publishers, full reference scans, quarantine changes, and deletion for one canonical volume root. */
export async function withVolumeContentStoreLease<T>(volumeRoot: string, work: () => Promise<T>): Promise<T> {
  const root = resolve(volumeRoot); const key = leaseKey(root)
  if (activeOwnership(key)) return work()
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: Release
  const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
  tails.set(key, current)
  await previous
  let handle: Awaited<ReturnType<typeof open>> | undefined
  const lockPath = resolve(root, '.ash', 'content-store.lock')
  try {
    await mkdir(resolve(root, '.ash'), { recursive: true })
    const ash = await lstat(resolve(root, '.ash')); if (!ash.isDirectory() || ash.isSymbolicLink()) throw new Error('Content-store lease directory is unsafe')
    const deadline = Date.now() + 30_000
    while (!handle) {
      try { handle = await open(lockPath, 'wx'); await handle.writeFile(`${process.pid}\n`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error; await new Promise((done) => setTimeout(done, 20)) }
    }
    const frame: LeaseOwnershipFrame = { key, token: Symbol(key), active: true }
    try { return await leaseContext.run([...(leaseContext.getStore() ?? []), frame], work) } finally { frame.active = false }
  } finally {
    if (handle) { await handle.close(); await unlink(lockPath).catch(() => undefined) }
    release(); if (tails.get(key) === current) tails.delete(key)
  }
}
