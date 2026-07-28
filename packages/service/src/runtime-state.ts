import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface PreparedTaskRuntimeDatabase {
  databasePath: string
  source: 'local' | 'migrated' | 'new'
}

const LOCAL_JOBS_DIRECTORY = 'jobs-v1'

export function localTaskRuntimeDatabasePath(home: string): string {
  return join(home, 'runtime', LOCAL_JOBS_DIRECTORY, 'jobs.sqlite')
}

export async function prepareTaskRuntimeDatabase(options: {
  home: string
  legacyDatabasePath: string
}): Promise<PreparedTaskRuntimeDatabase> {
  const databasePath = localTaskRuntimeDatabasePath(options.home)
  if (await isFile(databasePath)) return { databasePath, source: 'local' }

  const targetDirectory = dirname(databasePath)
  if (await pathExists(targetDirectory)) {
    if ((await readdir(targetDirectory)).length === 0) {
      return { databasePath, source: 'new' }
    }
    throw Object.assign(
      new Error(`Local task runtime directory is incomplete: ${targetDirectory}`),
      { code: 'TASK_RUNTIME_LOCAL_STATE_INCOMPLETE' },
    )
  }

  const runtimeRoot = dirname(targetDirectory)
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })

  if (!await isFile(options.legacyDatabasePath)) {
    await mkdir(targetDirectory, { mode: 0o700 })
    return { databasePath, source: 'new' }
  }

  const stagingDirectory = await mkdtemp(join(runtimeRoot, `.${LOCAL_JOBS_DIRECTORY}-migrate-`))
  let stagingExists = true
  try {
    const stagingDatabasePath = join(stagingDirectory, 'jobs.sqlite')
    await copyFile(options.legacyDatabasePath, stagingDatabasePath)
    await chmod(stagingDatabasePath, 0o600)

    const legacyWalPath = `${options.legacyDatabasePath}-wal`
    if (await isFile(legacyWalPath)) {
      const stagingWalPath = `${stagingDatabasePath}-wal`
      await copyFile(legacyWalPath, stagingWalPath)
      await chmod(stagingWalPath, 0o600)
    }

    await writeFile(join(stagingDirectory, 'migration.json'), `${JSON.stringify({
      schemaVersion: 1,
      source: options.legacyDatabasePath,
      migratedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 })
    await chmod(stagingDirectory, 0o700)
    await rename(stagingDirectory, targetDirectory)
    stagingExists = false
    return { databasePath, source: 'migrated' }
  } catch (error) {
    if (await isFile(databasePath)) return { databasePath, source: 'local' }
    throw error
  } finally {
    if (stagingExists) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
