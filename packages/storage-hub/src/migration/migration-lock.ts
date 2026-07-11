import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'

interface LockOwner { token: string; pid: number; createdAt: string }
export interface MigrationFileLock { release(): Promise<void> }
export interface MigrationLockOptions { breakStale?: boolean; afterCreate?: () => Promise<void> }

function parseOwner(text: string): LockOwner | undefined {
  try { const value = JSON.parse(text) as Partial<LockOwner>; return typeof value.token === 'string' && Number.isInteger(value.pid) && typeof value.createdAt === 'string' ? value as LockOwner : undefined } catch { return undefined }
}
async function ownerAt(path: string): Promise<LockOwner | undefined> { return readFile(path, 'utf8').then(parseOwner, () => undefined) }
function alive(pid: number): boolean { try { process.kill(pid, 0); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error } }

async function removeOwned(path: string, token: string, required: boolean): Promise<boolean> {
  const current = await ownerAt(path); if (!current) { if (required) throw new Error('Storage mapping transaction lock has unknown owner'); return false } if (current.token !== token) return false
  const claimed = `${path}.claim-${token}`
  try { await rename(path, claimed) } catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  const moved = await ownerAt(claimed)
  if (moved?.token !== token) { await rename(claimed, path).catch(() => undefined); if (required) throw new Error('Storage mapping transaction lock ownership changed'); return false }
  await unlink(claimed); return true
}

export async function acquireMigrationFileLock(bootstrapPath: string, input: boolean | MigrationLockOptions = {}): Promise<MigrationFileLock> {
  const options = typeof input === 'boolean' ? { breakStale: input } : input; const lockPath = `${bootstrapPath}.migration.lock`
  if (options.breakStale) {
    const owner = await ownerAt(lockPath)
    if (!owner) { try { await readFile(lockPath); throw new Error('Storage mapping transaction lock has unknown owner') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
    else if (alive(owner.pid)) throw new Error('Storage mapping transaction lock is already held')
    else await removeOwned(lockPath, owner.token, true)
  }
  let handle
  try { handle = await open(lockPath, 'wx') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Storage mapping transaction lock is already held', { cause: error }); throw error }
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() }
  try { await options.afterCreate?.(); await handle.writeFile(JSON.stringify(owner)); await handle.sync() } catch (error) { await handle.close(); await unlink(lockPath).catch(() => undefined); throw error }
  let released = false
  return { release: async () => { if (released) return; released = true; await handle.close(); await removeOwned(lockPath, owner.token, false) } }
}
