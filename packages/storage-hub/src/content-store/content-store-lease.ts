import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir } from 'node:fs/promises'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

type Release = () => void
const tails = new Map<string, Promise<void>>()
interface LeaseOwnershipFrame { key: string; token: symbol; active: boolean }
interface LeaseOwner { version: 1; token: string; pid: number; processIdentity: string; createdAt: string }
type ContentStoreLockErrorCode = 'BUSY' | 'UNKNOWN_OWNER' | 'IDENTITY_UNAVAILABLE'
class ContentStoreLockError extends Error {
  constructor(readonly code: ContentStoreLockErrorCode, message: string) { super(message); this.name = 'ContentStoreLockError' }
}
const leaseContext = new AsyncLocalStorage<readonly LeaseOwnershipFrame[]>()
const waitArray = new Int32Array(new SharedArrayBuffer(4))
const pause = (milliseconds: number) => Atomics.wait(waitArray, 0, 0, milliseconds)
const leaseKey = (root: string) => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)
const activeOwnership = (key: string) => leaseContext.getStore()?.some((frame) => frame.key === key && frame.active) === true
let selfIdentity: string | undefined

function parseOwner(text: string): LeaseOwner | { pid: number; legacy: true } | undefined {
  const legacyPid = /^\s*(\d+)\s*$/.exec(text)?.[1]
  if (legacyPid) return { pid: Number(legacyPid), legacy: true }
  try {
    const value = JSON.parse(text) as Partial<LeaseOwner>
    return value.version === 1 && typeof value.token === 'string' && Number.isInteger(value.pid) && typeof value.processIdentity === 'string' && typeof value.createdAt === 'string' ? value as LeaseOwner : undefined
  } catch { return undefined }
}

function ownerAt(path: string): ReturnType<typeof parseOwner> {
  try { return parseOwner(readFileSync(path, 'utf8')) } catch { return undefined }
}

function inspectProcess(pid: number): { alive: boolean; identity?: string } {
  try { process.kill(pid, 0) } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? { alive: false } : { alive: true } }
  try {
    if (process.platform === 'win32') {
      const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().Ticks.ToString()}`], { encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: tmpdir(), TMP: tmpdir() } }).trim()
      return { alive: true, identity: value ? `win32:${value}` : undefined }
    }
    if (process.platform === 'linux') {
      const text = readFileSync(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(') ') + 2).split(' ')
      return { alive: true, identity: fields[19] ? `linux:${fields[19]}` : undefined }
    }
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return { alive: true, identity: value ? `${process.platform}:${value}` : undefined }
  } catch {
    try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false } }
    return { alive: true }
  }
}

function removeOwned(lockPath: string, owner: LeaseOwner | { pid: number; legacy: true }): boolean {
  const current = ownerAt(lockPath)
  const matches = current && ('legacy' in owner ? 'legacy' in current && current.pid === owner.pid : !('legacy' in current) && current.token === owner.token)
  if (!matches) return false
  const claimPath = `${lockPath}.claim-${'legacy' in owner ? `legacy-${owner.pid}-${randomUUID()}` : owner.token}`
  try { renameSync(lockPath, claimPath) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  const claimed = ownerAt(claimPath)
  const claimMatches = claimed && ('legacy' in owner ? 'legacy' in claimed && claimed.pid === owner.pid : !('legacy' in claimed) && claimed.token === owner.token)
  if (!claimMatches) { try { renameSync(claimPath, lockPath) } catch { /* another owner now fails closed */ }; return false }
  unlinkSync(claimPath)
  return true
}

function acquireFileLeaseSync(lockPath: string, timeoutMs = 500): Release {
  const identity = selfIdentity ??= inspectProcess(process.pid).identity
  if (!identity) throw new ContentStoreLockError('IDENTITY_UNAVAILABLE', 'Content-store lock process identity is unavailable')
  const deadline = Date.now() + timeoutMs
  while (true) {
    let descriptor: number
    try { descriptor = openSync(lockPath, 'wx') }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        if (Date.now() >= deadline) throw new ContentStoreLockError('BUSY', 'Content-store lock lease is busy')
        pause(20); continue
      }
      if (code !== 'EEXIST') throw error
      const owner = ownerAt(lockPath)
      if (!owner) {
        if (Date.now() >= deadline) throw new ContentStoreLockError('UNKNOWN_OWNER', 'Content-store lock has unknown owner')
        pause(20); continue
      }
      const state = inspectProcess(owner.pid)
      if (state.alive && ('legacy' in owner || state.identity === owner.processIdentity)) {
        if (Date.now() >= deadline) throw new ContentStoreLockError('BUSY', 'Content-store lock lease is busy')
        pause(20); continue
      }
      if (state.alive && !state.identity) throw new ContentStoreLockError('IDENTITY_UNAVAILABLE', 'Content-store lock process identity is unavailable; refusing stale recovery')
      if (!removeOwned(lockPath, owner)) continue
      continue
    }
    const owner: LeaseOwner = { version: 1, token: randomUUID(), pid: process.pid, processIdentity: identity, createdAt: new Date().toISOString() }
    try { writeFileSync(descriptor, JSON.stringify(owner)); fsyncSync(descriptor) }
    catch (error) { closeSync(descriptor); try { unlinkSync(lockPath) } catch { /* future acquisition fails closed */ }; throw error }
    let released = false
    return () => { if (released) return; released = true; closeSync(descriptor); removeOwned(lockPath, owner) }
  }
}

async function acquireFileLease(lockPath: string): Promise<Release> {
  const deadline = Date.now() + 30_000
  while (true) {
    try { return acquireFileLeaseSync(lockPath, 0) }
    catch (error) {
      if (!(error instanceof ContentStoreLockError) || !['BUSY', 'UNKNOWN_OWNER'].includes(error.code) || Date.now() >= deadline) throw error
      await new Promise((done) => setTimeout(done, 20))
    }
  }
}

export function acquireVolumeContentStoreLeaseSync(volumeRoot: string): Release {
  const root = resolve(volumeRoot); const key = leaseKey(root)
  if (tails.has(key)) throw new Error('Content-store lock lease is busy')
  const ashPath = resolve(root, '.ash'); const lockPath = resolve(ashPath, 'content-store.lock')
  mkdirSync(ashPath, { recursive: true }); const ash = lstatSync(ashPath)
  if (!ash.isDirectory() || ash.isSymbolicLink()) throw new Error('Content-store lease directory is unsafe')
  return acquireFileLeaseSync(lockPath)
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
  const lockPath = resolve(root, '.ash', 'content-store.lock')
  let releaseFile: Release | undefined
  try {
    await mkdir(resolve(root, '.ash'), { recursive: true })
    const ash = await lstat(resolve(root, '.ash')); if (!ash.isDirectory() || ash.isSymbolicLink()) throw new Error('Content-store lease directory is unsafe')
    releaseFile = await acquireFileLease(lockPath)
    const frame: LeaseOwnershipFrame = { key, token: Symbol(key), active: true }
    try { return await leaseContext.run([...(leaseContext.getStore() ?? []), frame], work) } finally { frame.active = false }
  } finally {
    releaseFile?.()
    release(); if (tails.get(key) === current) tails.delete(key)
  }
}
