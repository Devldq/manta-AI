import { open, readFile, unlink } from 'node:fs/promises'

export interface MigrationFileLock { release(): Promise<void> }

export async function acquireMigrationFileLock(bootstrapPath: string, breakStale = false): Promise<MigrationFileLock> {
  const lockPath = `${bootstrapPath}.migration.lock`
  if (breakStale) {
    const owner = await readFile(lockPath, 'utf8').then((text) => JSON.parse(text) as { pid?: number }, () => undefined)
    if (owner?.pid) { try { process.kill(owner.pid, 0); throw new Error('Storage mapping transaction lock is already held') } catch (error) { if (error instanceof Error && error.message.includes('already held')) throw error; if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
    await unlink(lockPath).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Storage mapping transaction lock is already held', { cause: error }) })
  }
  let handle
  try { handle = await open(lockPath, 'wx') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Storage mapping transaction lock is already held', { cause: error }); throw error }
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); await handle.sync()
  let released = false
  return { release: async () => { if (released) return; released = true; await handle.close(); await unlink(lockPath).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) } }
}
