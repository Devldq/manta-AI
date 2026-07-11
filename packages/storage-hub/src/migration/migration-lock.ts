import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { powershell } from '../platform/powershell'

interface LockOwner { token: string; pid: number; processIdentity: string; createdAt: string }
export interface ProcessInspection { alive: boolean; identity?: string }
export interface MigrationFileLock { release(): Promise<void> }
export interface MigrationLockOptions { breakStale?: boolean; afterCreate?: () => Promise<void>; inspectProcess?: (pid: number) => Promise<ProcessInspection> }
let selfInspection: Promise<ProcessInspection> | undefined

function parseOwner(text: string): LockOwner | undefined {
  try { const value = JSON.parse(text) as Partial<LockOwner>; return typeof value.token === 'string' && Number.isInteger(value.pid) && typeof value.processIdentity === 'string' && typeof value.createdAt === 'string' ? value as LockOwner : undefined } catch { return undefined }
}
async function ownerAt(path: string): Promise<LockOwner | undefined> { return readFile(path, 'utf8').then(parseOwner, () => undefined) }
async function run(file: string, args: string[]): Promise<string> { const { execFile } = await import('node:child_process'); return new Promise((resolve, reject) => execFile(file, args, (error, stdout) => error ? reject(error) : resolve(stdout.trim()))) }
export async function inspectProcess(pid: number): Promise<ProcessInspection> {
  try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false }; throw error }
  try {
    if (process.platform === 'linux') { const text = await readFile(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(') ') + 2).split(' '); return { alive: true, identity: fields[19] ? `linux:${fields[19]}` : undefined } }
    if (process.platform === 'win32') { const script = "(Get-Process -Id ([int]$env:ASH_LOCK_PID) -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()"; const value = await powershell.run(script, '', { ...process.env, ASH_LOCK_PID: String(pid) }); return { alive: true, identity: value ? `win32:${value}` : undefined } }
    if (process.platform === 'darwin') { const value = await run('ps', ['-o', 'lstart=', '-p', String(pid)]); return { alive: true, identity: value ? `darwin:${value}` : undefined } }
    return { alive: true }
  } catch { return { alive: true } }
}

async function removeOwned(path: string, token: string, required: boolean): Promise<boolean> {
  const current = await ownerAt(path); if (!current) { if (required) throw new Error('Storage mapping transaction lock has unknown owner'); return false } if (current.token !== token) return false
  const claimed = `${path}.claim-${token}`
  try { await rename(path, claimed) } catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  const moved = await ownerAt(claimed)
  if (moved?.token !== token) { await rename(claimed, path).catch(() => undefined); if (required) throw new Error('Storage mapping transaction lock ownership changed'); return false }
  await unlink(claimed); return true
}

export async function acquireMigrationFileLock(bootstrapPath: string, input: boolean | MigrationLockOptions = {}): Promise<MigrationFileLock> {
  const options = typeof input === 'boolean' ? { breakStale: input } : input; const inspect = options.inspectProcess ?? inspectProcess; const lockPath = `${bootstrapPath}.migration.lock`
  if (options.breakStale) {
    const owner = await ownerAt(lockPath)
    if (!owner) { try { await readFile(lockPath); throw new Error('Storage mapping transaction lock has unknown owner') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
    else { const processState = await inspect(owner.pid); if (processState.alive && !processState.identity) throw new Error('Storage mapping transaction process identity is unavailable; refusing stale recovery'); if (processState.alive && processState.identity === owner.processIdentity) throw new Error('Storage mapping transaction lock is already held'); await removeOwned(lockPath, owner.token, true) }
  }
  const self = await (options.inspectProcess ? inspect(process.pid) : (selfInspection ??= inspectProcess(process.pid))); if (!self.alive || !self.identity) throw new Error('Storage mapping transaction process identity is unavailable')
  let handle
  try { handle = await open(lockPath, 'wx') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Storage mapping transaction lock is already held', { cause: error }); throw error }
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, processIdentity: self.identity, createdAt: new Date().toISOString() }
  try { await options.afterCreate?.(); await handle.writeFile(JSON.stringify(owner)); await handle.sync() } catch (error) { await handle.close(); await unlink(lockPath).catch(() => undefined); throw error }
  let released = false
  return { release: async () => { if (released) return; released = true; await handle.close(); await removeOwned(lockPath, owner.token, false) } }
}
